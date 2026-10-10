"""Replay captured velocity-ring brackets with the current native search.

The ring metadata/value words and last-evaluated cache time are supplied from
accepted game-only snapshots. Native bracket search executes without shims;
two-point vector arithmetic is a float32 projection of the bound instructions.
This does not execute cache invalidation, its callers or value metadata helpers.
"""
import argparse, collections, hashlib, importlib.util, json, math, runpy, struct, sys
from pathlib import Path
REPO=Path(__file__).resolve().parents[1]
ROOT=REPO.parent/'native-audit'
spec=importlib.util.spec_from_file_location('native_history',REPO/'tools/reaudit-velocity-history.py')
native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
from unicorn.x86_const import *
F=native.F
u=native.u

def invoke(row,cubic):
    x=row['extra'];rings=x['velocityHistoryRings'];flags=x['velocityWrapperFlags']
    requested=row['velocityCacheTimes'][0]
    assert len(rings)==1 and rings[0]['components']==1 and requested>=0
    u.mem_write(native.wrapper,bytes(0xc000))
    u.mem_write(native.wrapper+0x10,bytes(flags))
    u.mem_write(native.wrapper+0x20,struct.pack('<Q',native.rings))
    cubic_address=0xdb925c+7+struct.unpack('<i',native.read(0xdb925f,4))[0]
    u.mem_write(cubic_address,bytes([cubic]))
    pointers={}
    for k,r in enumerate(rings):
        data=[native.data0,native.data1][k]
        u.mem_write(native.rings+32*k,struct.pack('<QIIiIfI',data,r['packed'],r['freeMask'],r['validityTick'],0,r['timeOffset'],0))
        assert r['count']==len(r['entries']) and 0<r['count']<=r['capacity']<=32
        for e in r['entries']:
            assert 0<=e['physical']<r['capacity'] and 0<=e['valueIndex']<r['capacity']
            assert len(e['valueWords'])==r['components']*10
            assert list(struct.unpack('<3f',struct.pack('<3I',*e['valueWords'][:3])))==e['vectors'][0]
            u.mem_write(data+e['physical']*8,struct.pack('<ihh',e['tick'],e['valueIndex'],0))
            ptr=data+r['capacity']*8+e['valueIndex']*r['components']*40
            u.mem_write(ptr,struct.pack('<'+'I'*len(e['valueWords']),*e['valueWords']))
            pointers[ptr]=e['vectors'][0]
    u.mem_write(native.stack,struct.pack('<Q',native.stop))
    for reg,val in [(UC_X86_REG_RDI,native.wrapper),(UC_X86_REG_RSI,0),(UC_X86_REG_RDX,native.out),
                    (UC_X86_REG_RCX,row['interpolationContext']['bracketMode']),(UC_X86_REG_R8,native.status),(UC_X86_REG_RSP,native.stack)]:u.reg_write(reg,val)
    u.reg_write(UC_X86_REG_XMM0,int.from_bytes(struct.pack('<f',requested),'little'))
    native.active={'instructions':0}
    u.emu_start(0xdb8e20,native.stop,count=3000)
    assert u.reg_read(UC_X86_REG_RIP)==native.stop
    raw=bytes(u.mem_read(native.out,0x40));success=bool(u.reg_read(UC_X86_REG_RAX))
    selected_ptrs=[struct.unpack_from('<Q',raw,at)[0]for at in [0,16,32]]
    selected_ticks=[struct.unpack_from('<i',raw,at)[0]for at in [8,24,40]]
    frac=struct.unpack_from('<f',raw,48)[0]
    selected=[pointers.get(p)for p in selected_ptrs]
    prediction=None
    if success and not raw[56]:
        newer,older=selected[:2]
        assert newer is not None and older is not None
        prediction=list(older) if frac==0 else list(newer)if frac==1 else[F(a+F(F(b-a)*frac))for a,b in zip(older,newer)]
    return {'success':success,'ticks':selected_ticks,'selectedVectors':selected,'fraction':frac,'threePoint':bool(raw[56]),
            'pastNewest':bool(raw[57]),'rawFraction':struct.unpack_from('<f',raw,52)[0],'prediction':prediction}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture',type=Path,default=REPO/'docs/evidence/reaudit-motion-runtime-fixture.json')
    parser.add_argument('--out',type=Path,default=ROOT/'reports/reaudit-velocity-runtime')
    parser.add_argument('--summary',type=Path,default=REPO/'docs/evidence/reaudit-velocity-runtime.json')
    args=parser.parse_args()
    OUT=args.out;OUT.mkdir(parents=True,exist_ok=True)
    rows,fixture,fixture_sha=runpy.run_path(str(REPO/'tools/reaudit-motion-capture-fixture.py'))['load_fixture'](args.fixture)
    assert fixture['clientSha256']==native.sha
    assertions={0xdcbc98:'subss xmm1, xmm6',0xdcbc9c:'mulss xmm3, xmm0',
                0xdcccea:'subps xmm2, xmm4',0xdccd07:'mulps xmm2, xmm3',0xdccd4f:'addps xmm0, xmm3'}
    from capstone import Cs,CS_ARCH_X86,CS_MODE_64
    cs=Cs(CS_ARCH_X86,CS_MODE_64)
    for at,expected in assertions.items():
        ins=next(cs.disasm(native.read(at,15),at));assert ins.mnemonic+' '+ins.op_str==expected
    code_ranges=[]
    for name,start,end in [('bracket',0xdb8e20,0xdb934b),('cache-evaluator',0xdcc4c0,0xdccdd6),
                           ('pawn-getter',0xdccde0,0xdcd0ac),('two-point-value',0xdcbaa0,0xdcc4c0)]:
        code_ranges.append(dict(name=name,bytes=end-start,sha256=hashlib.sha256(native.read(start,end-start)).hexdigest()))
    result=[];modes=collections.Counter();global_effect=0
    for i,row in enumerate(rows):
        a=invoke(row,1);b=invoke(row,0)
        if a!=b:global_effect+=1
        modes[(a['success'],a['threePoint'],a['pastNewest'])]+=1
        error=None if a['prediction']is None else max(abs(a['prediction'][j]-row['velocityCache0'][j])for j in range(3))
        result.append({'row':i,'monotonic':row['monotonic'],'frame':row['frame'],'tick':row['tick'],
                       'cacheTime':row['velocityCacheTimes'][0],'context':row['interpolationContext'],
                       'storedVelocity':row['storedVelocity'],'cacheVelocity':row['velocityCache0'],
                       'native':a,'error':error,'globalCubicFlagChangesResult':a!=b,
                       'ringNewestTick':row['extra']['velocityHistoryRings'][0]['entries'][0]['tick']})
    (OUT/'rows.jsonl').write_text(''.join(json.dumps(x)+'\n'for x in result))
    compared=[x for x in result if x['error']is not None]
    worst=sorted(compared,key=lambda x:x['error'],reverse=True)[:10]
    # Cache zero is the getter's selected value for this observed stage-zero,
    # single-ring branch only when selector is -1. Do not project other stages.
    assert all(r['interpolationContext']['stage']==0 and
               not r['extra']['velocityWrapperFlags'][0]&0x20 for r in rows)
    active=[x for x,r in zip(result,rows) if r['velocityInterpolationEnabled'] and
            r['moveType']!=5 and r['interpolationContext']['selector']==-1]
    assert all(x['cacheTime']==x['context']['times'][1] for x in active)
    stale=[]
    for now in compared:
        if now['error']==0: continue
        previous=next((old for old in reversed(result[:now['row']]) if old['error']==0 and
            old['cacheTime']==now['cacheTime'] and old['cacheVelocity']==now['cacheVelocity']),None)
        stale.append(dict(row=now['row'],earlierMatchingRow=None if previous is None else previous['row'],
            frameGap=None if previous is None else now['frame']-previous['frame'],
            sameCacheTimeAndValue=previous is not None,
            selectedHistoryChanged=previous is not None and previous['native']['selectedVectors']!=now['native']['selectedVectors']))
    (OUT/'stale-cache.json').write_text(json.dumps(stale,indent=2)+'\n')
    report={'clientSha256':native.sha,'snapshotSha256':fixture['sourceSnapshotSha256'],
            'fixtureSha256':fixture_sha,'probeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'ranges':code_ranges,
            'rows':len(rows),'nativeInvocations':2*len(rows),'arithmeticInstructionAssertions':len(assertions),
            'modes':[{'success':k[0],'threePoint':k[1],'pastNewest':k[2],'rows':v}for k,v in modes.items()],
            'globalCubicFlagChangesResult':global_effect,'projectedRows':len(compared),
            'exactRows':sum(x['error']==0 for x in compared),'within1e5':sum(x['error']<=1e-5 for x in compared),
            'maxError':max(x['error']for x in compared),'worst':worst,
            'selectedCacheZero':dict(rows=len(active),exactRows=sum(x['error']==0 for x in active),
                requestedTimeMatches=True,maxError=max(x['error']for x in active),
                nonzeroRows=sum(any(x['cacheVelocity']) for x in active)),
            'retainedCacheMismatches':dict(rows=len(stale),allHaveEarlierExactCache=all(x['sameCacheTimeAndValue']for x in stale),
                allOneFrameEarlier=all(x['frameGap']==1 for x in stale),
                allSelectedHistoryChanged=all(x['selectedHistoryChanged']for x in stale),
                allCurrentSelectorZero=all(result[x['row']]['context']['selector']==0 for x in stale)),
            'productionChanged':False,'limits':[__doc__,
                'All retained histories have one ring with a 1/64 second offset; its producer is not established.',
                'Cache time and numeric vector can outlive the history that produced them; polling is not a call trace.',
                'The cubic global flag was not captured. Both supplied values give the same result for every retained row.',
                'Only the observed stage-zero, single-ring cache-selection branch is classified here.']}
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    shared={k:v for k,v in report.items()if k!='worst'}
    args.summary.write_text(json.dumps(shared,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items()if k not in['worst','limits']}))
if __name__=='__main__':main()
