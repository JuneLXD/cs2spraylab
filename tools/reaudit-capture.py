"""Record an identity-checked CS2 window; optional output audio uses a sidecar.
Keeping PulseAudio out of the video process prevents observed multi-second
x11grab frame drops. Separate process launch clocks are retained, not presented
as sample-exact audiovisual synchronization or physical input latency.
"""
import json,os,re,subprocess,sys,time
from pathlib import Path

root=Path(__file__).resolve().parents[2]/'native-audit'
name,window,sequence=sys.argv[1:4]
actions=json.loads(Path(sequence).read_text())
reports=root/'reports';output=reports/(name+'.mkv');audio=reports/(name+'.wav')
if output.exists()or audio.exists():raise RuntimeError('Capture already exists')
env=os.environ|{'DISPLAY':':0','XAUTHORITY':'/run/user/1000/gdm/Xauthority'}
identity=subprocess.check_output(['xprop','-id',window,'_NET_WM_NAME','WM_CLASS'],text=True,env=env)
if '"Counter-Strike 2"'not in identity or '"cs2", "cs2"'not in identity:raise RuntimeError('Selected window is not CS2')
info=subprocess.check_output(['xwininfo','-id',window],text=True,env=env)
width=int(re.search(r'Width:\s*(\d+)',info)[1]);height=int(re.search(r'Height:\s*(\d+)',info)[1])
monitor=os.environ.get('CS2_AUDIT_AUDIO_MONITOR')
if monitor:
 sources=subprocess.check_output(['pactl','list','short','sources'],text=True)
 if not monitor.endswith('.monitor')or monitor not in[line.split()[1]for line in sources.splitlines()]:
  raise RuntimeError('Select an existing explicit output monitor; microphone capture is forbidden')
clock=lambda:{'wall':time.time(),'monotonic':time.monotonic()}
start=clock();audio_start=None;audio_recorder=None;result=None
log=(reports/(name+'-ffmpeg.log')).open('w');audio_log=None
recorder=subprocess.Popen(['bash',str(root/'ffmpeg-portable.sh'),'-hide_banner','-loglevel','warning',
 '-thread_queue_size','64','-f','x11grab','-probesize','32','-video_size',f'{width}x{height}','-framerate','60','-draw_mouse','0','-window_id',str(int(window,0)),
 '-i',':0','-c:v','libx264','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p','-threads','2',str(output)],stdin=subprocess.PIPE,stdout=log,stderr=log,env=env)
try:
 if monitor:
  audio_log=(reports/(name+'-audio-ffmpeg.log')).open('w');audio_start=clock()
  audio_recorder=subprocess.Popen(['bash',str(root/'ffmpeg-portable.sh'),'-hide_banner','-loglevel','warning',
   '-thread_queue_size','64','-f','pulse','-i',monitor,'-c:a','pcm_s16le','-ar','48000','-ac','2',str(audio)],stdin=subprocess.PIPE,stdout=audio_log,stderr=audio_log,env=env)
 time.sleep(1)
 if recorder.poll()is not None or(audio_recorder and audio_recorder.poll()is not None):raise RuntimeError('Recorder failed to start')
 result=subprocess.run([sys.executable,str(root/'x11-input.py'),window,json.dumps(actions),str(reports/(name+'-inputs.jsonl'))],env=env)
 time.sleep(1)
finally:
 for process in [recorder,audio_recorder]:
  if process and process.poll()is None:process.stdin.write(b'q\n');process.stdin.flush()
 for process in [recorder,audio_recorder]:
  if process:process.wait(timeout=20)
 log.close()
 if audio_log:audio_log.close()
 (reports/(name+'-capture.json')).write_text(json.dumps({'name':name,'start':start,'audioStart':audio_start,'stop':clock(),
  'video':str(output),'videoSize':[width,height],'audio':str(audio)if monitor else None,'inputResult':result.returncode if result else None,
  'recorderResult':recorder.returncode,'audioRecorderResult':audio_recorder.returncode if audio_recorder else None,
  'captureHzRequested':60,'audioMonitor':monitor,
  'note':'Synthetic X11 input. Inspect decoded PTS before counting video samples. Separate audio/video launch clocks are approximate synchronization only; neither establishes physical input latency.'},indent=2)+'\n')
if recorder.returncode or(audio_recorder and audio_recorder.returncode)or not result or result.returncode:sys.exit(1)
print(output)
