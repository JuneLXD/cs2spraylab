"""Extract the installed server's embedded command-history protobuf descriptor."""
import hashlib,json,mmap,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'native-audit';sys.path.insert(0,str(ROOT/'python'))
from google.protobuf.descriptor_pb2 import FileDescriptorProto
with (ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so').open('rb')as f:
 m=mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ)
 server_sha=hashlib.sha256(m).hexdigest()
 assert server_sha=='c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
 name=b'cs_usercmd.proto';start=m.find(b'\n'+bytes([len(name)])+name);assert start>=0
 def varint(p):
  x=0;s=0
  while True:
   b=m[p];p+=1;x|=(b&127)<<s
   if b<128:return x,p
   s+=7;assert s<64
 p=start
 while True:
  tag,q=varint(p)
  if not tag:break
  if tag&7==2:length,q=varint(q);q+=length
  elif tag&7==0:_,q=varint(q)
  elif tag&7==5:q+=4
  elif tag&7==1:q+=8
  else:break
  p=q;assert p-start<100000
 d=FileDescriptorProto();d.ParseFromString(m[start:p]);assert d.name==name.decode()
 out={'file':d.name,'serverSha256':server_sha,'descriptorSha256':hashlib.sha256(m[start:p]).hexdigest(),'descriptorBytes':p-start,'messages':{msg.name:[{'name':field.name,'number':field.number,'type':field.type,'label':field.label,'default':field.default_value,'type_name':field.type_name}for field in msg.field]for msg in d.message_type}}
 (ROOT/'reports/reaudit-attack-history-protobuf.json').write_text(json.dumps(out,indent=2)+'\n')
 print(json.dumps(out,indent=2))
