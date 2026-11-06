"""Independent check of covariance propagation for q=L*d/ell."""
from pathlib import Path
import json,argparse,numpy as np
ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,default=Path(__file__).parent/'results');args=ap.parse_args()
out=args.out;out.mkdir(parents=True,exist_ok=True)
rng=np.random.default_rng(20261107)
mu=np.array([150.,113.57816691600547,113.57816691600547])
sd=np.array([.7,.5,.05]);g=np.array([mu[2]/mu[1],-mu[2]*mu[0]/mu[1]**2,mu[0]/mu[1]])
result=[]
for rho in [-.8,0,.8]:
 cov=np.diag(sd**2);cov[0,1]=cov[1,0]=rho*sd[0]*sd[1]
 x=rng.multivariate_normal(mu,cov,size=100000)
 q=x[:,2]*x[:,0]/x[:,1];error=q-150
 u=float(np.sqrt(g@cov@g));naive=float(np.sqrt(np.sum(g*g*np.diag(cov))))
 result.append(dict(correlation=rho,n=100000,variance_mc=float(np.var(q,ddof=1)),
  variance_linear=float(u*u),variance_without_cov=float(naive*naive),
  coverage_full=float(np.mean(abs(error)<=1.95996398454*u)),
  coverage_without_cov=float(np.mean(abs(error)<=1.95996398454*naive))))
payload=dict(seed=20261107,mean_inputs=mu.tolist(),std_inputs=sd.tolist(),results=result,
 purpose='implementation and local uncertainty propagation check, not a new mathematical result')
(out/'covariance_check.json').write_text(json.dumps(payload,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2))
