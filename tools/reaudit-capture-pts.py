"""Inspect decoded video timestamps rather than trusting its nominal frame rate.
Run: python3 tools/reaudit-capture-pts.py capture.mkv report.json
Uses the same vendored OpenCV as native-audit; no recording or playback occurs.
"""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'native-audit/python'))
import cv2
cv2.setNumThreads(1)
source=Path(sys.argv[1]); cap=cv2.VideoCapture(str(source));nominal=cap.get(cv2.CAP_PROP_FPS)
rows=[]
while True:
 ok,frame=cap.read()
 if not ok:break
 rows.append(cap.get(cv2.CAP_PROP_POS_MSEC)/1000)
cap.release()
intervals=[b-a for a,b in zip(rows,rows[1:])]
gaps=[{'frame':i+1,'from':rows[i],'to':rows[i+1],'seconds':delta}for i,delta in enumerate(intervals)if delta>.05]
result={'source':source.name,'nominalHz':nominal,'decodedFrames':len(rows),'firstPTS':rows[0]if rows else None,'lastPTS':rows[-1]if rows else None,'maxInterval':max(intervals)if intervals else None,'gapsOver50ms':gaps,'timestamps':rows,'limitation':'Decoded timestamps establish sample availability, not unique rendered game frames or mouse-to-photon latency.'}
Path(sys.argv[2]).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items()if k not in ['timestamps','gapsOver50ms']}|{'gapsOver50ms':len(gaps)}))
