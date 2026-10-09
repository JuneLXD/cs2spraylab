"""Capture only our own synthetic X11 test window; never the desktop."""
import argparse,ctypes as C,json,os,subprocess,time
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--mode',choices=['video','combined','separate'],default='video')
parser.add_argument('--monitor',default='auto_null.monitor')
parser.add_argument('--output',required=True,type=Path)
args=parser.parse_args()
r=Path(__file__).resolve().parents[2]/'native-audit'
if args.output.exists():raise RuntimeError('Output exists; preserve prior evidence')
args.output.parent.mkdir(parents=True,exist_ok=True)
if args.mode!='video':
 if subprocess.check_output(['pactl','list','short','sink-inputs'],text=True).strip():raise RuntimeError('Self-check requires an idle output sink; no application audio is recorded')
 sources=subprocess.check_output(['pactl','list','short','sources'],text=True)
 if not args.monitor.endswith('.monitor')or args.monitor not in[line.split()[1]for line in sources.splitlines()]:raise RuntimeError('Use an explicit existing output monitor')
x=C.CDLL('libX11.so.6')
def fn(name,args,result=None):
 f=getattr(x,name);f.argtypes=args
 if result:f.restype=result
 return f
ptr=C.c_void_p; ul=C.c_ulong;ui=C.c_uint;ci=C.c_int
fn('XOpenDisplay',[C.c_char_p],ptr);fn('XDefaultRootWindow',[ptr],ul);fn('XCreateSimpleWindow',[ptr,ul,ci,ci,ui,ui,ui,ul,ul],ul)
fn('XStoreName',[ptr,ul,C.c_char_p]);fn('XMapWindow',[ptr,ul]);fn('XFlush',[ptr]);fn('XCreateGC',[ptr,ul,ul,ptr],ptr);fn('XSetForeground',[ptr,ptr,ul]);fn('XFillRectangle',[ptr,ul,ptr,ci,ci,ui,ui]);fn('XDestroyWindow',[ptr,ul]);fn('XCloseDisplay',[ptr])
d=x.XOpenDisplay(None)
if not d:raise RuntimeError('No display')
w=x.XCreateSimpleWindow(d,x.XDefaultRootWindow(d),20,20,640,360,0,0,0);x.XStoreName(d,w,b'Audit recorder self-check');x.XMapWindow(d,w);x.XFlush(d);g=x.XCreateGC(d,w,0,None);time.sleep(.4)
output=args.output
video_input=['-thread_queue_size','64','-f','x11grab','-probesize','32','-video_size','640x360','-framerate','60','-draw_mouse','0','-window_id',str(w),'-i',':0']
audio_input=['-thread_queue_size','64','-f','pulse','-i',args.monitor]
cmd=['bash',str(r/'ffmpeg-portable.sh'),'-nostdin','-v','warning',*video_input,*(audio_input if args.mode=='combined'else []),'-t','8','-c:v','libx264','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p','-threads','2',*(['-c:a','pcm_s16le','-ar','48000','-ac','2']if args.mode=='combined'else []),str(output)]
audio=None

try:
 with output.with_suffix('.log').open('w')as log:
  p=subprocess.Popen(cmd,stdout=log,stderr=log)
  if args.mode=='separate':audio=subprocess.Popen(['bash',str(r/'ffmpeg-portable.sh'),'-nostdin','-v','warning',*audio_input,'-t','8','-c:a','pcm_s16le','-ar','48000','-ac','2',str(output.with_suffix('.wav'))],stdout=log,stderr=log)
  start=time.monotonic();n=0
  while p.poll()is None and time.monotonic()-start<20:
   x.XSetForeground(d,g,0x202632);x.XFillRectangle(d,w,g,0,0,640,360)
   x.XSetForeground(d,g,0x88bbdd);x.XFillRectangle(d,w,g,(n*5)%600,150,40,40);x.XFlush(d);n+=1;time.sleep(.015)
  if p.poll()is None:p.terminate()
  p.wait(timeout=5)
  if audio:audio.wait(timeout=20)
  print(json.dumps({'mode':args.mode,'audioExit':audio.returncode if audio else None,'exit':p.returncode,'window':hex(w),'framesDrawn':n,'seconds':time.monotonic()-start}))
finally:x.XDestroyWindow(d,w);x.XCloseDisplay(d)
