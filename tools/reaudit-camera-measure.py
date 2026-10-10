"""Fresh re-audit camera rotation, masking the large cl_showpos overlay, HUD and gun.
Native 1920x1080 unstretched footage uses fx=fy=360 after resize to 960x540.
The other intrinsics are retained only as diagnostics, not fitted camera models.
"""
import sys,json,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'native-audit/python'))
import cv2,numpy as np
cv2.setNumThreads(1)
source=Path(sys.argv[1]);output=Path(sys.argv[2]);start=float(sys.argv[3]);stop=float(sys.argv[4]);referenceAt=float(sys.argv[5]) if len(sys.argv)>5 else start
cap=cv2.VideoCapture(str(source));fps=cap.get(cv2.CAP_PROP_FPS)
sift=cv2.SIFT_create(nfeatures=2500,contrastThreshold=.02);matcher=cv2.BFMatcher()
mask=np.zeros((540,960),np.uint8);mask[70:330,530:930]=255;mask[270:330,30:440]=255
frames=[]
while True:
 ok,frame=cap.read()
 if not ok: break
 at=cap.get(cv2.CAP_PROP_POS_MSEC)/1000
 if at>max(stop,referenceAt)+.1: break
 if at>=min(start,referenceAt)-.1: frames.append((at,cv2.resize(frame,(960,540))))
if not frames: raise RuntimeError('No frames decoded in requested range')
referenceTime,referenceFrame=min(frames,key=lambda pair:abs(pair[0]-referenceAt))
ref=cv2.cvtColor(referenceFrame,cv2.COLOR_BGR2GRAY);rk,rd=sift.detectAndCompute(ref,mask)
rows=[]
for index,(at,frame) in enumerate(frames):
 if not start<=at<stop: continue
 gray=cv2.cvtColor(cv2.resize(frame,(960,540)),cv2.COLOR_BGR2GRAY);k,d=sift.detectAndCompute(gray,mask)
 matches=[a for a,b in matcher.knnMatch(rd,d,k=2) if a.distance<.7*b.distance] if d is not None else []
 if len(matches)<12:continue
 p=np.float32([rk[m.queryIdx].pt for m in matches]);q=np.float32([k[m.trainIdx].pt for m in matches]);H,inliers=cv2.findHomography(p,q,cv2.RANSAC,.8,maxIters=4000,confidence=.999)
 if H is None:continue
 used=inliers[:,0].astype(bool)
 if used.sum()<12:continue
 residual=float(np.sqrt(np.mean(np.sum((cv2.perspectiveTransform(p[used,None,:],H)[:,0,:]-q[used])**2,axis=1))))
 rotations=[]
 for fx,fy in [(360,360),(480,360),(480,480)]:
  K=np.array([[fx,0,480],[0,fy,270],[0,0,1.]])
  R=np.linalg.inv(K)@H@K;R/=np.linalg.det(R)**(1/3);u,s,v=np.linalg.svd(R);rot=u@v
  rotations.append(dict(fx=fx,fy=fy,pitch=math.atan2(rot[1,2],rot[2,2])*180/math.pi,yaw=math.atan2(rot[0,2],rot[2,2])*180/math.pi,rigidity=float(np.linalg.norm(R-rot))))
 rows.append(dict(frame=index,t=at,inliers=int(used.sum()),residual=residual,homography=H.tolist(),rotations=rotations))
output.write_text(json.dumps(dict(video=source.name,fps=fps,referenceAt=referenceTime,decodedFrames=len(frames),samples=rows),indent=2)+'\n');print('Measured',len(rows),'frames')
