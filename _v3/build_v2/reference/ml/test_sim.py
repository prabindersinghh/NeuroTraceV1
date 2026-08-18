"""Simulation: 4 baseline days + 3 stable days + 3 decline days. Proves the alert gate."""
import numpy as np, importlib.util, sys

def load(name):
    spec = importlib.util.spec_from_file_location(name, f"{name}.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

baseline = load("baseline"); scoring = load("scoring"); explain = load("explain")
rng = np.random.default_rng(42)

VK = ["pause_ratio","n_pauses_per_sec","articulation_rate","jitter_local","shimmer_local","hnr","f0_cv"]
FK = ["mouth_symmetry_mean","corner_drop_mean","eye_asymmetry_mean","brow_asymmetry_mean","landmark_tremor"]
RK = ["rt_median","rt_cov","lapse_rate","attention_decay_slope","miss_rate"]

NORM = {"pause_ratio":0.25,"n_pauses_per_sec":0.8,"articulation_rate":4.2,"jitter_local":0.012,
        "shimmer_local":0.05,"hnr":18.0,"f0_cv":0.15,
        "mouth_symmetry_mean":0.04,"corner_drop_mean":0.02,"eye_asymmetry_mean":0.05,
        "brow_asymmetry_mean":0.03,"landmark_tremor":0.002,
        "rt_median":420,"rt_cov":0.18,"lapse_rate":0.05,"attention_decay_slope":0.5,"miss_rate":0.03}

def day(keys, drift=0.0):
    d = {"valid":1.0}
    for k in keys:
        base = NORM[k]
        noise = rng.normal(0, abs(base)*0.05)
        # decline pushes "bad direction": hnr & articulation_rate go DOWN, rest UP
        sign = -1.0 if k in ("hnr","articulation_rate") else 1.0
        d[k] = base + noise + sign*drift*abs(base)*0.55
    return d

# --- build baselines from 4 clean days ---
vb = baseline.build_baseline([day(VK) for _ in range(4)], VK)
fb = baseline.build_baseline([day(FK) for _ in range(4)], FK)
rb = baseline.build_baseline([day(RK) for _ in range(4)], RK)
print(f"baseline ready: voice={vb['ready']} face={fb['ready']} reaction={rb['ready']}\n")

history = []
plan = [("stable",0.0)]*3 + [("decline",1.0),("decline",1.6),("decline",2.2)]
for i,(label,drift) in enumerate(plan, start=5):
    vf, ff, rf = day(VK,drift), day(FK,drift), day(RK,drift)
    vz = baseline.z_scores(vf, vb, VK); fz = baseline.z_scores(ff, fb, FK); rz = baseline.z_scores(rf, rb, RK)
    devs = {"voice":baseline.modality_deviation(vz),
            "face":baseline.modality_deviation(fz),
            "reaction":baseline.modality_deviation(rz)}
    score = scoring.stability_score(devs, {"voice":True,"face":True,"reaction":True})
    history.append({"devs":devs,"score":score})
    decision = scoring.alert_decision(history)
    allz = {**vz,**fz,**rz}
    msg = explain.explain(allz, decision["band"], "en")
    print(f"Day {i} [{label}] dev v/f/r = {devs['voice']:.2f}/{devs['face']:.2f}/{devs['reaction']:.2f}"
          f" | score={score:5.1f} | {decision['band']:<6} ({decision['reason']})")
    print(f"        -> {msg}\n")
