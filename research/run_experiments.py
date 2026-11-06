"""Synthetic image-coordinate experiments. Requires only NumPy.

Not an SfM, feature detector, photorealistic renderer, or smartphone benchmark.
All camera poses/intrinsics are known in a common arbitrary coordinate gauge.
Truth is used only to generate observations and to score outcomes.
"""
import argparse, csv, hashlib, json, platform, time
from pathlib import Path
import numpy as np

SEED=20261106
STRATEGIES=['object_only','periodic_3','alternating','random','frozen_plan','adaptive','wide_only']
SCENARIOS={
 'reference_weak':dict(object_span=28,reference_span=2,uL=.05,actual_noise=.7),
 'object_weak':dict(object_span=2,reference_span=28,uL=.05,actual_noise=.7),
 'balanced':dict(object_span=28,reference_span=28,uL=.05,actual_noise=.7),
 'reference_floor':dict(object_span=28,reference_span=2,uL=1.0,actual_noise=.7),
 'noise_underestimated':dict(object_span=28,reference_span=2,uL=.05,actual_noise=1.4),
}
P_TRUE=np.array([[-65,-20,-15],[65,25,45],[305,65,-20],[405,85,30]],float)
L_TRUE=float(np.linalg.norm(P_TRUE[3]-P_TRUE[2]))
Q_TRUE=float(np.linalg.norm(P_TRUE[1]-P_TRUE[0]))
F=1600.; CX=640.; CY=480.; FORECAST_NOISE=.7
CENTERS=[P_TRUE[:2].mean(0),P_TRUE[2:].mean(0),(P_TRUE[0]+P_TRUE[3])/2]
# Camera aims are fixture coordinates supplied to the estimator. They are not
# estimated from future data. The fixture is the same in every repeated trial.
def camera(center,azimuth,elevation,radius):
 a,e=np.deg2rad([azimuth,elevation])
 c=center+radius*np.array([np.sin(a)*np.cos(e),np.sin(e),np.cos(a)*np.cos(e)])
 z=(center-c);z/=np.linalg.norm(z)
 x=np.cross(z,np.array([0.,1.,0.]));x/=np.linalg.norm(x)
 y=np.cross(z,x)
 return c,np.array([x,y,z])

def fixture(sc):
 poses=[];family=[];labels=[]
 for fam,span in [(0,sc['object_span']),(1,sc['reference_span'])]:
  for a in [-span,0,span]:
   poses.append(camera(CENTERS[fam],a,18,600));family.append(fam);labels.append(f'initial_{fam}_{a}')
 for fam in range(3):
  for el in [10,35]:
   for a in [-65,-40,-15,15,40,65]:
    poses.append(camera(CENTERS[fam],a,el,600 if fam<2 else 1250));family.append(fam);labels.append(f'{fam}_{a}_{el}')
 return np.array([x[0] for x in poses]),np.array([x[1] for x in poses]),np.array(family),labels

def project(points,C,R):
 # points: batch,4,3. Outputs batch,view,4,2 and analytic Jacobians.
 pc=np.einsum('vij,bvpj->bvpi',R,points[:,None,:,:]-C[None,:,None,:])
 z=pc[...,2]
 uv=F*pc[...,:2]/z[...,None]+np.array([CX,CY])
 J=F/z[...,None,None]*(R[None,:,None,:2,:]-pc[...,:2,None]/z[...,None,None]*R[None,:,None,2:3,:])
 visible=(z>50)&(uv[...,0]>16)&(uv[...,0]<1264)&(uv[...,1]>16)&(uv[...,1]<944)
 # Retain either complete measured segment only. Every visible segment is used,
 # including a reference in an object-targeted frame and vice versa.
 visible[...,:2]=np.all(visible[...,:2],axis=-1)[...,None]
 visible[...,2:]=np.all(visible[...,2:],axis=-1)[...,None]
 return uv,J,visible

def normal(J,selected,visible):
 w=selected[:,:,None]*visible/FORECAST_NOISE**2
 return np.einsum('bvpki,bvpkj,bvp->bpij',J,J,w)

def fit(obs,selected,C,R,visible):
 # Linear normalized-coordinate triangulation initializes nonlinear WLS.
 xn=(obs-np.array([CX,CY]))/F
 A=xn[...,None]*R[None,:,None,2:3,:]-R[None,:,None,:2,:]
 rhs=np.einsum('bvpkj,vj->bvpk',A,C)
 w=selected[:,:,None]*visible
 H=np.einsum('bvpki,bvpkj,bvp->bpij',A,A,w)
 b=np.einsum('bvpki,bvpk,bvp->bpi',A,rhs,w)
 p=np.linalg.solve(H+np.eye(3)*1e-14,b[...,None])[...,0]
 for _ in range(4):
  uv,J,_=project(p,C,R)
  H=normal(J,selected,visible)
  b=np.einsum('bvpki,bvpk,bvp->bpi',J,obs-uv,w/FORECAST_NOISE**2)
  delta=np.linalg.solve(H+np.eye(3)*1e-10,b[...,None])[...,0]
  p+=delta
 uv,J,_=project(p,C,R)
 H=normal(J,selected,visible)
 cov=np.linalg.inv(H+np.eye(3)*1e-10)
 return p,H,cov

def measure(p,cov,L,uL):
 od=p[:,1]-p[:,0];rd=p[:,3]-p[:,2]
 d=np.linalg.norm(od,axis=-1);ell=np.linalg.norm(rd,axis=-1)
 q=L*d/ell
 og=(L/ell)[:,None]*od/d[:,None]
 rg=-(L*d/ell**2)[:,None]*rd/ell[:,None]
 g=np.stack([-og,og,-rg,rg],axis=1)
 components=np.einsum('bpi,bpij,bpj->bp',g,cov,g)
 floor=(d/ell*uL)**2
 var=components.sum(-1)+floor
 return q,var,g,components,floor

def predict(p,H,g,floor,C,R):
 _,J,vis=project(p,C,R)
 add=np.einsum('bvpki,bvpkj->bvpij',J,J)*vis[...,None,None]/FORECAST_NOISE**2
 updated=np.linalg.inv(H[:,None]+add+np.eye(3)*1e-10)
 v=np.einsum('bpi,bvpij,bpj->bv',g,updated,g)+floor[:,None]
 return v,add

def choose(strategy,step,p,H,g,floor,available,C,R,family,random_order,frozen):
 if strategy=='random':
  scores=np.where(available,random_order,np.inf)
  return np.argmin(scores,axis=1)
 if strategy=='frozen_plan':return frozen[step]
 scores,_=predict(p,H,g,floor,C,R)
 allowed=available.copy()
 if strategy=='object_only':allowed&=(family[None,:]==0)
 if strategy=='wide_only':allowed&=(family[None,:]==2)
 if strategy=='periodic_3':allowed&=(family[None,:]==(1 if (step+1)%3==0 else 0))
 if strategy=='alternating':allowed&=(family[None,:]==(step%2))
 return np.argmin(np.where(allowed,scores,np.inf),axis=1)

def wilson(k,n):
 z=1.95996398454;p=k/n;den=1+z*z/n
 mid=(p+z*z/(2*n))/den
 rad=z*np.sqrt(p*(1-p)/n+z*z/(4*n*n))/den
 return [float(mid-rad),float(mid+rad)]

def diagnostics():
 sc=SCENARIOS['balanced'];C,R,_,_=fixture(sc)
 uv,J,vis=project(P_TRUE[None],C,R)
 h=1e-5
 err=[]
 for k in range(3):
  plus=P_TRUE.copy();minus=P_TRUE.copy();plus[:,k]+=h;minus[:,k]-=h
  fd=(project(plus[None],C,R)[0]-project(minus[None],C,R)[0])/(2*h)
  err.append(float(np.max(np.abs(fd-J[...,k]))))
 selected=np.zeros((1,len(C)),bool);selected[:,:6]=True
 p,H,cov=fit(uv,selected,C,R,vis)
 q,var,_,_,_=measure(p,cov,np.array([L_TRUE]),.05)
 result={'projection_jacobian_max_abs_difference':max(err),'noiseless_length_error_mm':float(abs(q[0]-Q_TRUE)),
  'ground_truth_object_length_mm':Q_TRUE,'ground_truth_reference_length_mm':L_TRUE,
  'initial_min_information_eigenvalue':float(np.linalg.eigvalsh(H).min())}
 assert result['projection_jacobian_max_abs_difference']<1e-5
 assert result['noiseless_length_error_mm']<1e-6
 return result

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--trials',type=int,default=600);ap.add_argument('--steps',type=int,default=8)
 ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
 args.out.mkdir(parents=True,exist_ok=True)
 started=time.time();rng=np.random.default_rng(SEED);rows=[];summary=[];pairs=[]
 checks=diagnostics()
 settings=dict(seed=SEED,trials_per_scenario=args.trials,additional_actions=args.steps,initial_frames=6,
   total_frame_budget=6+args.steps,strategies=STRATEGIES,scenarios=SCENARIOS,
   points=P_TRUE.tolist(),focal_px=F,image_size=[1280,960],assumed_pixel_std=FORECAST_NOISE,
   known_camera_poses=True,estimator='DLT initialization plus 4 Gauss Newton WLS iterations',
   uncertainty='local conditional covariance from Jacobians plus independent reference length uncertainty',
   interval='q_hat plus or minus 1.95996398454 times u, normal local approximation',
   allocation_cost='one image action regardless of move time',
   visibility='16 pixel image margin, both segment endpoints in front and inside frame',
   all_visible_segments_used=True,bootstrap_replicates=3000)
 (args.out/'settings.json').write_text(json.dumps(settings,indent=2),encoding='utf-8')
 for sn,sc in SCENARIOS.items():
  C,R,family,labels=fixture(sc);B=args.trials;V=len(C);ids=np.arange(B)
  noiseless,_,truth_visibility=project(P_TRUE[None],C,R)
  obs=noiseless+rng.normal(0,sc['actual_noise'],size=(B,V,4,2))
  vis=np.broadcast_to(truth_visibility,(B,V,4)).copy()
  L=L_TRUE+rng.normal(0,sc['uL'],B)
  initial=np.zeros((B,V),bool);initial[:,:6]=True
  p0,H0,cov0=fit(obs,initial,C,R,vis)
  q0,v0,g0,components0,floor0=measure(p0,cov0,L,sc['uL'])
  _,add0=predict(p0,H0,g0,floor0,C,R)
  # A strong baseline preplans the entire sequence from the noisy initial fit,
  # updating information while keeping initial geometry fixed.
  frozen=[];Ha=H0.copy();avail=~initial
  for k in range(args.steps):
   updated=np.linalg.inv(Ha[:,None]+add0+np.eye(3)*1e-10)
   scores=np.einsum('bpi,bvpij,bpj->bv',g0,updated,g0)+floor0[:,None]
   a=np.argmin(np.where(avail,scores,np.inf),axis=1);frozen.append(a)
   Ha+=add0[ids,a];avail[ids,a]=False
  rand_order=rng.uniform(size=(B,V));finals={};initial_errors=q0-Q_TRUE
  np.savez_compressed(args.out/f'observations_{sn}.npz',pixels=obs,visible=vis,reference_observed_mm=L,
     camera_centers=C,camera_rotations=R,camera_family=family,points_for_scoring_only=P_TRUE)
  for strategy in STRATEGIES:
   selected=initial.copy();p=p0.copy();H=H0.copy();cov=cov0.copy();q=q0.copy();var=v0.copy();g=g0.copy();floor=floor0.copy()
   for step in range(args.steps+1):
    if step:
     a=choose(strategy,step-1,p,H,g,floor,~selected,C,R,family,rand_order,frozen)
     assert np.all(~selected[ids,a]);selected[ids,a]=True
     p,H,cov=fit(obs,selected,C,R,vis)
     q,var,g,comp,floor=measure(p,cov,L,sc['uL'])
    else:a=np.full(B,-1)
    u=np.sqrt(var);error=q-Q_TRUE
    assert np.isfinite(q).all() and np.isfinite(u).all() and (u>0).all()
    for i in range(B):rows.append([sn,strategy,i,step,int(a[i]),int(family[a[i]]) if step else -1,
      float(q[i]),float(error[i]),float(u[i]),float(abs(error[i])<=1.95996398454*u[i]),
      int(np.sum(selected[i]&(family==1))),int(np.sum(selected[i]&(family==2)))])
   finals[strategy]=(error.copy(),u.copy())
   covered=np.abs(error)<=1.95996398454*u
   summary.append(dict(scenario=sn,strategy=strategy,n=B,rmse_mm=float(np.sqrt(np.mean(error**2))),
     bias_mm=float(np.mean(error)),median_u_mm=float(np.median(u)),coverage95=float(np.mean(covered)),
     coverage_wilson=wilson(int(covered.sum()),B),mean_width_mm=float(np.mean(3.91992796908*u)),
     success_05mm=float(np.mean(np.abs(error)<=.5)),success_1mm=float(np.mean(np.abs(error)<=1)),
     success_2mm=float(np.mean(np.abs(error)<=2)),p95_abs_error_mm=float(np.quantile(abs(error),.95)),
     initial_rmse_mm=float(np.sqrt(np.mean(initial_errors**2))),
     selected_object_views=float(np.mean(np.sum(selected&(family==0),axis=1)-3)),
     selected_reference_views=float(np.mean(np.sum(selected&(family==1),axis=1)-3)),
     selected_wide_views=float(np.mean(np.sum(selected&(family==2),axis=1)))))
  # Paired bootstrap resamples entire independent simulated sessions.
  boot=np.random.default_rng(SEED+list(SCENARIOS).index(sn)+100).integers(0,B,size=(3000,B))
  ea=finals['adaptive'][0];ra=float(np.sqrt(np.mean(ea**2)))
  for comparator in ['object_only','periodic_3','alternating','random','frozen_plan','wide_only']:
   eb=finals[comparator][0];rb=float(np.sqrt(np.mean(eb**2)))
   ratio=np.sqrt(np.mean(ea[boot]**2,axis=1))/np.sqrt(np.mean(eb[boot]**2,axis=1))
   pairs.append(dict(scenario=sn,comparator=comparator,adaptive_rmse_mm=ra,baseline_rmse_mm=rb,
     rmse_ratio=ra/rb,ratio_ci95=np.quantile(ratio,[.025,.975]).tolist()))
  print(sn,[(x['strategy'],round(x['rmse_mm'],4),round(x['coverage95'],3)) for x in summary if x['scenario']==sn],flush=True)
 header=['scenario','strategy','trial','step','action_index','camera_family','q_mm','error_mm','u_mm','covered95','reference_frames_total','wide_frames_total']
 with (args.out/'trajectories.csv').open('w',newline='',encoding='utf-8-sig') as f:
  w=csv.writer(f);w.writerow(header);w.writerows(rows)
 (args.out/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
 (args.out/'paired_comparisons.json').write_text(json.dumps(pairs,indent=2),encoding='utf-8')
 (args.out/'checks.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
 scalar_keys=[k for k,v in summary[0].items() if not isinstance(v,list)]
 with (args.out/'summary.csv').open('w',newline='',encoding='utf-8-sig') as f:
  w=csv.DictWriter(f,fieldnames=scalar_keys,extrasaction='ignore');w.writeheader();w.writerows(summary)
 manifest=dict(python=platform.python_version(),numpy=np.__version__,elapsed_seconds=time.time()-started,
   trajectory_rows=len(rows),nonfinite_results=0,checks=checks,
   source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
   files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in args.out.iterdir() if p.is_file()})
 (args.out/'run_manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
 print('DONE',manifest['elapsed_seconds'],'seconds',len(rows),'rows',flush=True)
if __name__=='__main__':main()
