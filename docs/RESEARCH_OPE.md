# Off-policy evaluation: literature brief for the Awaaz ranking scaffold

**Status:** research note, not a decision record and not an authorisation. It reviews
published methods for offline policy evaluation and maps them onto the code in
`backend/app/ml/rl/`. Nothing here permits deployment, online exploration, or a clinical
claim; those remain governed by `docs/PLAN_RL.md` step 7 and PRD §11. Every numeric claim
attributed to a paper is cited inline. Every numeric claim **not** cited is arithmetic
done here from our own constants and is labelled as such.

**Update, 2026-08-31.** Findings 1, 2, 4, 5, 11, 12 and 15 of the register in §8 have been
acted on, in some cases by fixing the code and in one case by deciding not to. Each row of
that table now carries its disposition, and §3.2, §5 and §7.4 are annotated in place. The
most consequential outcome is that finding 1 — the phrase-board reward inversion — was a real
correctness bug that this brief found by hand-tracing the reward, and it is fixed (D-065).

Scope of the surface under evaluation, restated so the reading of the literature stays
honest: a contextual bandit with a slate of at most `contracts.MAX_CANDIDATES` (8) already
generated and already safety-screened, one logged action per event, a bounded reward
derived only from the patient's own explicit selection / rejection / correction /
phrase-board fallback, no online exploration ever, and a corpus that is per-patient and
therefore tiny. Almost the entire OPE literature was written for the opposite regime —
web-scale logs, many users, and the option of an online A/B test to check the offline
answer. That mismatch is the running theme of this document and is stated plainly in the
final section rather than papered over.

---

## 1. Estimator choice

### 1.1 The four families

All of the estimators below start from the same identity. If the logging policy π₀
assigned probability π₀(a|x) to the action it actually took, then re-weighting logged
rewards by w = π(a|x)/π₀(a|x) makes the logged sample look like a sample from π. This is
the Horvitz–Thompson construction, published for survey sampling in 1952 and unchanged
since ([Horvitz & Thompson, JASA 1952](https://doi.org/10.1080/01621459.1952.10483446)).
Inverse propensity scoring (IPS) is Horvitz–Thompson applied to logged bandit feedback;
the modern learning-theoretic treatment for policy *learning* from such logs is
counterfactual risk minimisation ([Swaminathan & Joachims, ICML
2015](https://proceedings.mlr.press/v37/swaminathan15.html)).

| Estimator | Form | Bias | Variance | Needs | Breaks when |
|---|---|---|---|---|---|
| IPS / Horvitz–Thompson | `Σ wᵢrᵢ / n` | Unbiased under full support + correct π₀ | Scales with `E[w²]`; unbounded if π₀ can be small | Known, non-degenerate π₀; full support | Support deficiency, unknown/estimated π₀, heavy weight tails, reward scale not anchored at 0 |
| SNIPS / self-normalised | `Σ wᵢrᵢ / Σ wᵢ` | Biased, consistent; bias O(1/n) for a ratio estimator | Materially lower; bounded by reward range | Same as IPS | Small n (bias not negligible), deficient support, one weight dominating `Σ wᵢ` |
| Doubly robust (DR) | `Σ [q̂(x,a') + wᵢ(rᵢ − q̂(x,aᵢ))] / n` | Unbiased if *either* π₀ or the reward model q̂ is correct | Lower than IPS when q̂ is decent | A separately validated reward model | q̂ is fit on the same tiny log (leakage); q̂ is wrong *and* weights are heavy |
| SWITCH / clipped / shrinkage | Use q̂ where `w > τ`, DR/IPS where `w ≤ τ`; or shrink w toward 0 | Deliberately biased | Deliberately lower | A reward model plus a tuned τ or shrinkage λ | τ/λ tuned on the same data you then report; deficient support is not fixed by any τ |

DR is [Dudík, Langford & Li, ICML 2011](https://arxiv.org/abs/1103.4601): "previous
approaches rely either on models of rewards or models of the past policy — the former are
plagued by a large bias whereas the latter have a large variance", and DR is unbiased if
either component is correct. SWITCH is [Wang, Agarwal & Dudík, ICML
2017](https://proceedings.mlr.press/v70/wang17a.html), which also establishes a minimax
lower bound on MSE that IPS and DR match up to constants in the agnostic setting — i.e.
*no estimator can do better than IPS/DR without a reward model*, and SWITCH's advantage
comes entirely from having one. Weight clipping and weight shrinkage are unified in [Su,
Dimakopoulou, Krishnamurthy & Dudík, ICML
2020](https://proceedings.mlr.press/v119/su20a.html), which "shrinks the importance
weights to minimize a bound on the mean squared error" and notes that when the reward
predictor is poor the method degenerates to plain weight clipping.

### 1.2 Why SNIPS rather than IPS, precisely

The published argument for self-normalisation is not "lower variance". It is
*equivariance*. [Swaminathan & Joachims (NeurIPS
2015)](https://proceedings.neurips.cc/paper/2015/hash/39027dfad5138c9ca0c474d71db915c3-Abstract.html)
identify **propensity overfitting**: when IPS is optimised over a rich hypothesis class,
the learner discovers it can improve the *estimate* by manipulating `Σ wᵢ` rather than by
choosing better actions. With positive rewards it learns to place mass where the logger
rarely went (small `Σ w`, small estimated loss); with negative rewards it learns the
mirror image. The fix they propose is the multiplicative control variate that yields the
self-normalised estimator, which is invariant to a constant added to every reward and to a
constant multiplying every weight.

That property matters for us more than for most: our reward is not anchored at zero. From
`rewards.score_logged_action` and `rewards.RewardConfig` defaults (0.8 / 0.2), the total
reward takes values in **[−1.0, +0.8]** with 0.0 sitting in the *middle* of the scale, not
at the bottom. An estimator that is not translation-equivariant therefore reads "no
evidence" as "middling outcome", which is a systematically optimistic error. SNIPS is
equivariant; IPS is not.

There is also an exact algebraic redundancy in the current code worth recording. In
`offline._estimate`, `ips_reward = Σwr/n` and `snips_reward = Σwr/Σw` and `weight_mass =
Σw/n`, so identically `ips_reward == snips_reward * weight_mass`. The IPS figure carries
no information beyond the SNIPS figure and the already-reported weight mass. It is fine to
keep it as a human-readable cross-check, but it is not an independent diagnostic and
should not be described as one.

### 1.3 What breaks at small n, specifically

Three separate small-sample failures, which are often conflated:

1. **Weight-tail variance.** IPS variance scales with `E[w²]`. With at most 8 candidates
   and a logger that randomises meaningfully, `w` can plausibly reach 8; a single event
   carrying `w = 20` (our `MAX_IMPORTANCE_WEIGHT_CEILING`) against `n = 50` contributes
   roughly 40% of `Σ w`. That is one patient tap deciding the comparison.
2. **Ratio-estimator bias.** SNIPS is biased; the bias is O(1/n) and is *not* negligible
   when n is 50. [Kuzborskij, Vernade, György & Szepesvári (AISTATS
   2021)](https://arxiv.org/abs/2006.10460) build their lower bound around exactly this,
   combining "a semi-empirical Efron-Stein tail inequality to control the concentration
   and a new multiplicative (rather than additive) control of the bias". An interval that
   only accounts for concentration and ignores the SN bias is optimistic by construction.
3. **Support deficiency**, which is not a variance problem at all and is treated in §5.

A fourth, structural one: the log is not free of the ranker that produced it. With
uniform-ish logging over K actions, only about 1/K of the log is informative about any one
action — the classic replay-evaluation observation from [Li, Chu, Langford & Wang (WSDM
2011)](https://arxiv.org/abs/1003.5956). With `MAX_CANDIDATES = 8` and `MIN_EVENTS_FLOOR =
50`, that is on the order of **six informative events per candidate slot** (our
arithmetic, not theirs).

### 1.4 Recommendation on estimator

Keep SNIPS as the estimate. Do not add DR, SWITCH, or shrinkage yet — all three require a
reward model q̂, and PRD §11 already defers DR until "a separately validated outcome model
exists", which is the right call: fitting q̂ on the same 50-event per-patient log and then
reporting a DR estimate from it is leakage dressed as variance reduction. The one
exception worth planning for is that SWITCH-style *clipping* (not shrinkage) needs no
reward model if you accept the imputation of a constant; but the constant you would impute
is exactly the zero that §5 shows is unsafe on our reward scale.

---

## 2. Sample size — the decision-relevant question

**Headline: the literature does not supply a fixed minimum event count, and any document
that claims it does is wrong.** What the literature supplies is (a) the statement that the
governing quantity is not `n` but the effective sample size implied by the weight
distribution, and (b) minimax results showing that required `n` scales with the second
moment of the importance weights. So "50 events" cannot be defended or refuted in the
abstract; it can only be evaluated against a stated effect size and a stated weight
distribution.

### 2.1 What the governing quantity actually is

The diagnostic used in `offline._estimate` — `ESS = (Σw)² / Σw²` — is the standard
importance sampling effective sample size, derived in Kong's 1992 technical note and used
as a rule of thumb ever since. It is worth knowing that its foundations are shaky:
[Elvira, Martino & Robert, *Rethinking the Effective Sample
Size*](https://arxiv.org/abs/1809.04129) show that "the multiple assumptions and
approximations in the derivation … makes it difficult to be considered even as a
reasonable approximation of the ESS". It remains a useful *alarm* — a low value is
reliably bad news — but it is not a sample size and should not be spoken of as one.

The theoretical statement of the same idea is the minimax MSE lower bound in [Wang,
Agarwal & Dudík (2017)](https://proceedings.mlr.press/v70/wang17a.html): in the agnostic
setting without a consistent reward model, no estimator beats IPS/DR up to constants, and
the bound is driven by the weight second moment. Required sample size is therefore a
function of overlap, not a constant.

### 2.2 Our own minimum-detectable-effect arithmetic

The following is **our calculation**, using the standard normal approximation for a paired
mean difference — not a result from any cited paper. It is included because it is the only
way to make the 50-event floor answerable.

`offline._bootstrap_delta` estimates a *paired* delta: baseline and candidate SNIPS are
computed on the same resampled index set, so the two estimates are strongly positively
correlated and the variance of the difference is much smaller than the sum of the
variances. That is a real and underappreciated strength of the current design. Let σ_d be
the standard deviation of the per-event contribution to that paired delta. The half-width
of a 95% interval is approximately `1.96 · σ_d / √ESS`, and `compare_policies` declares a
winner only when the interval clears `config.minimum_effect`. So the smallest true delta
the system can adjudicate is approximately `minimum_effect + 1.96 · σ_d / √ESS`.

Taking σ_d = 0.4 as a plausible mid-range value on a reward of total width 1.8, and
`minimum_effect = 0.02`:

| Effective sample size | 95% half-width | Smallest adjudicable true delta | As % of reward range (1.8) |
|---|---|---|---|
| 25 (our `MIN_EFFECTIVE_SAMPLE_SIZE_FLOOR`) | 0.157 | ≈ 0.18 | ≈ 10% |
| 50 | 0.111 | ≈ 0.13 | ≈ 7% |
| 100 | 0.078 | ≈ 0.10 | ≈ 5.5% |
| 400 | 0.039 | ≈ 0.06 | ≈ 3.3% |
| 800 | 0.028 | ≈ 0.05 | ≈ 2.7% |

Read the other way: to adjudicate a 0.10 delta you need ESS ≈ 96; to adjudicate 0.05 you
need ESS ≈ 680. Under the existing weight-mass gates an ESS/n ratio of roughly 0.5 is
realistic, so those correspond to **n ≈ 200 and n ≈ 1400 events respectively**.

### 2.3 Verdict on `MIN_EVENTS_FLOOR = 50`

It is defensible **as a floor**, in the narrow sense that it is the point below which the
event-level bootstrap of a ratio estimator stops being meaningful at all — which is what
the code comment already claims and which §3 supports. It is **not** defensible as a
sample size at which the system can answer the question it is being asked. At n = 50 the
scaffold can only detect differences of roughly a tenth of the reward range: the
difference between a ranker the patient accepts and one they reject about one time in ten.
Smaller, realistic ranking improvements are invisible.

The mismatch to fix is not the 50. It is `MINIMUM_EFFECT_FLOOR = 0.02`, which advertises a
resolution the design cannot deliver by roughly an order of magnitude. Two honest options:

- Raise `MINIMUM_EFFECT_FLOOR` to something the floor sample size can actually support (≈
  0.15 at ESS 25), so that a passing comparison means what it says; or
- Keep 0.02 but compute the achievable MDE from the realised ESS at runtime and block when
  `minimum_effect` is below it, so the config cannot promise resolution the data lacks.

The second is better, because it makes the gate a function of the data rather than a
guess.

A genuinely useful design comparison here is the **micro-randomised trial** literature
from mobile health, which is the one adjacent field that does per-person,
per-decision-point randomisation and takes sample size seriously: [Liao, Klasnja, Tewari &
Murphy, *Sample size calculations for micro-randomized trials in mHealth*, Statistics in
Medicine 2016](https://onlinelibrary.wiley.com/doi/abs/10.1002/sim.6847)
([preprint](https://arxiv.org/abs/1504.00238)); overview in [Klasnja et al., AJPH
2023](https://ajph.aphapublications.org/doi/full/10.2105/AJPH.2022.307150). The relevant
lesson is not a number but a discipline: MRTs *prespecify* the proximal outcome, the
randomisation probability, and the effect size, and derive the number of decision points
from them. Our scaffold does the reverse — it fixes n and leaves the effect size free.
PLAN_RL step 3 ("preregister the policy, reward, cohort unit, exclusions, and
minimum-support gates") already points at the fix; this section is the argument for why it
is load-bearing rather than procedural.

---

## 3. Confidence intervals, and the clustering problem

### 3.1 Bootstrap versus concentration bounds

The two families trade the same thing in opposite directions.

**Concentration bounds** (Hoeffding, empirical Bernstein) give finite-sample, one-sided
guarantees but are notoriously loose on importance-weighted returns. [Maurer & Pontil,
*Empirical Bernstein Bounds and Sample Variance Penalization* (COLT
2009)](https://arxiv.org/abs/0907.3740) is the standard variance-sensitive bound and is
what the OPE literature reaches for. It is used for exactly this purpose in [Thomas,
Theocharous & Ghavamzadeh, *High-Confidence Off-Policy Evaluation* (AAAI
2015)](https://ojs.aaai.org/index.php/AAAI/article/view/9541), which computes a lower
confidence bound on a policy's expected return. The cost is data hunger: [Hanna, Stone &
Niekum (2017)](https://arxiv.org/abs/1606.06126) put it directly — "due to the large
variance of importance sampled returns, these algorithms can require prohibitively large
amounts of data to produce meaningful confidence bounds", and "the amount of data required
for tight confidence bounds preclude the use of this method in data-scarce settings".

**Bootstrap** intervals are far tighter but carry no finite-sample guarantee. The same
paper is explicit that bootstrapping "only approximates the 5% allowable error rate" and
that "all methods can do worse than 5% when data is extremely sparse". This is the
accurate framing for our `_bootstrap_delta`: it is a *semi-safe* interval whose nominal
95% is an aspiration, not a guarantee.

Two modern options sit between the extremes and are worth tracking:

- [Kuzborskij et al. (AISTATS 2021)](https://arxiv.org/abs/2006.10460), a lower bound
  built specifically around the self-normalised estimator, handling concentration *and* SN
  bias. Reference implementation at
  [google-deepmind/offpolicy_selection_eslb](https://github.com/google-deepmind/offpolicy_selection_eslb).
- [Jin, Ren, Yang & Wang, *Policy learning "without"
  overlap*](https://arxiv.org/abs/2212.09900), which develops "a new self-normalized type
  concentration inequality for inverse-propensity- weighting estimators, generalizing the
  well-known empirical Bernstein's inequality to unbounded and non-i.i.d. data" — the
  non-i.i.d. part is directly relevant to §3.2.
- [Waudby-Smith, Wu, Ramdas, Karampatziakis & Mineiro, *Anytime-valid off-policy inference
  for contextual bandits*, ACM/IMS JDS 2024](https://arxiv.org/abs/2210.10768), which
  gives martingale-based confidence sequences valid at every sample size — attractive for
  a corpus that grows one patient session at a time, because it removes the temptation to
  peek.

### 3.2 The clustering problem, which is real here

`offline._bootstrap_delta` draws indices with `rng.randrange(n)` — an i.i.d. event-level
bootstrap. Events are not i.i.d. They cluster by patient, and within a patient by session
and by conversational topic. The statistical position is not controversial: with clustered
data the resampling unit must be the cluster, not the observation, because "if you have
correlated data … the unit of sampling no longer is the particular data point but the
second-level unit within which the data are correlated; otherwise you break the
correlation structure of the data by doing a naive bootstrap and distort the resultant
distributions" ([Deen & de Rooij, *ClusterBootstrap*, Behavior Research Methods
2020](https://link.springer.com/article/10.3758/s13428-019-01252-y); consistency results
in [Cheng, Yu & Huang, *The cluster bootstrap consistency in generalized estimating
equations*, JMVA
2013](https://www.sciencedirect.com/science/article/pii/S0047259X12002175)). Under
positive intra-cluster correlation the naive bootstrap is **anti-conservative**: the
interval is too narrow, so the failure mode is a false `candidate_better_offline`, which
is precisely the direction this package exists to prevent. Context clustering has begun to
be studied inside OPE itself — see [*Clustering Context in Off-Policy
Evaluation*](https://arxiv.org/abs/2502.21304) — but that work uses clustering to *reduce
variance*, not to fix inference, so it does not solve our problem.

**The awkward part:** `contracts.LoggedFeedback` deliberately carries no patient
identifier, by design and for good privacy reasons. So the correct resampling unit is not
merely absent from the code, it is absent from the schema. `LIMITATIONS` already concedes
that "event-level bootstrap intervals do not remove repeated-speaker dependence"; this
section upgrades that from a caveat to a known bias with a known sign.

**Disposition (2026-08-31, D-064): no cluster key will be added, and the recommendation in
this section is declined on privacy grounds.** A grouping id stable across one speaker's
events is a pseudonymous patient identifier — the collisions that make it useful for a
cluster bootstrap are exactly what make it a re-identification handle, and a per-event salt
would destroy the collisions the method depends on, so no salting or truncation separates the
two properties. The production table (`awaaz_policy_events`) carries no patient column and no
foreign key for the same reason. The bias is therefore carried rather than corrected: it is
the FIRST entry of `offline.LIMITATIONS`, states the direction ("the true interval is WIDER …
anti-conservative in exactly the direction that favours the candidate"), repeats in
`IMPROVEMENT_DOES_NOT_GUARANTEE` so it travels on the decision object, is named by
`UNCERTAINTY_BASIS` on every result, and `clustered_uncertainty_available` is a read-only
property that is permanently false. This section remains the argument for why that is a real
cost and not a formality.

---

## 4. Safe / conservative policy improvement

The canonical form of a defensible "do not deploy" criterion comes from [Thomas,
Theocharous & Ghavamzadeh, *High Confidence Policy Improvement* (ICML
2015)](https://proceedings.mlr.press/v37/thomas15.html), the policy-improvement companion
to the HCOPE paper. Its structure, and the thing worth copying, is:

> the user may select any performance lower-bound and confidence level and the algorithm will
> ensure that the probability that it returns a policy with performance below the lower bound
> is at most the specified confidence level.

Three properties make it the right template:

1. **The test is one-sided on a lower bound**, not two-sided on a point estimate. You ask
   "can I certify the candidate is at least this good?", never "which number is bigger?".
2. **The comparison is against a named baseline value**, typically the incumbent policy's
   performance — improvement is relative and explicit, not absolute.
3. **There is an explicit refusal outcome.** HCPI returns *No Solution Found* when it
   cannot certify improvement, and this is treated as a success of the method, not a
   failure of the run. Our `ComparisonStatus.inconclusive` is the same object and should
   be documented as such rather than as a disappointing result.

Related lines worth knowing: safe policy improvement with baseline bootstrapping
([Laroche, Trichelair & Tachet des Combes, ICML
2019](http://proceedings.mlr.press/v97/laroche19a/laroche19a.pdf)) constrains the new
policy to the baseline wherever data is thin, which is the policy-space analogue of §5's
support restriction; and [Jin et al. (2022)](https://arxiv.org/abs/2212.09900) show that
*optimising a lower confidence bound* rather than a point estimate is what buys you
guarantees when overlap is not uniform.

The medical framing is set by [Gottesman, Johansson, Komorowski, Faisal, Sontag,
Doshi-Velez & Celi, *Guidelines for reinforcement learning in healthcare*, Nature Medicine
25:16–18 (2019)](https://www.nature.com/articles/s41591-018-0310-5), which argues for
risk-conscious use of observational cohorts and against treating an offline value estimate
as evidence of clinical benefit. Our `OfflineComparison.deployment_allowed` /
`online_experiment_allowed` / `clinical_claim_allowed` read-only properties are an
unusually literal implementation of that guidance and should be kept.

---

## 5. Deficient support and overlap

This is the sharpest finding in the brief, and it lands on a specific line of our code.

[Sachdeva, Su & Joachims, *Off-policy Bandits with Deficient Support* (KDD
2020)](https://arxiv.org/abs/2006.09438):

> A key theoretical requirement of IPS weighting is that the policy that logged the data has
> "full support", which typically translates into requiring non-zero probability for any
> action in any context. Unfortunately, many real-world systems produce support deficient
> data, especially when the action space is large, and we show how existing methods can fail
> catastrophically.

The mechanism is simple and it is not a variance problem. If the target policy π puts mass
on an action the logger never took in that context, that mass contributes *nothing* to the
IPS sum — which is arithmetically identical to imputing a reward of **zero** for it. Their
Proposition 1 expresses the bias as the (negated) expected true reward on the unsupported
action set, so the size *and sign* of the bias depend entirely on where zero sits relative
to the real reward scale. The paper demonstrates this by translating the reward scale and
showing that naive IPS degrades sharply under the translation. Their three remedies are:
**restricting the action space**, **reward extrapolation**, and **restricting the policy
space**. A follow-up line uses auxiliary information to partially recover the unsupported
region ([*Off-Policy Evaluation with Deficient Support Using Side Information*, NeurIPS
2022](https://proceedings.neurips.cc/paper_files/paper/2022/file/c32be49c09eec3aad1f2bb587543e7f6-Paper-Conference.pdf)).

**Why this hits us hard.** Our reward is in [−1.0, +0.8] and zero means "the patient
neither accepted nor rejected, and made no repair". Zero is a *mid-scale, benign* outcome,
better than the −1.0 earned by a rejection or a phrase-board fallback. A candidate policy
that shifts mass onto never-logged actions is therefore rewarded, by the estimator's
arithmetic, for going somewhere we have no evidence about. That is propensity overfitting
(§1.2) with a concrete exploit path. SNIPS's translation-equivariance blunts it; it does
not remove the fact that unsupported mass is silently imputed.

**Our overlap diagnostic looks in the wrong direction.** In `offline._estimate`,
`overlap_rate = sum(weight > 0) / n`, and `weight` is `π_candidate(a_logged|x) /
π₀(a_logged|x)`. That is zero only when the *candidate* assigns no probability to the
action the logger happened to take. It measures whether the candidate covers the logger.
Deficient support is the opposite question — whether the *logger* covered the candidate —
and no quantity in `_estimate` can answer it, because the contract records π₀ only for the
single logged action. `MIN_OVERLAP_RATE_FLOOR = 0.80` is a real gate against a real
failure, but it is not the deficient-support gate its name suggests.

**The honest thing to report** is therefore threefold: the realised weight distribution
(max weight, ESS, weight mass — all already reported); the fraction of candidate
probability mass that falls on actions with no logged support (**not currently
computable**); and an explicit statement that the estimate is conditional on the supported
region, i.e. it estimates the value of the candidate *restricted to actions the logger
could have taken*, which is Sachdeva et al.'s support-restriction remedy stated as a
caveat rather than an algorithm.

**Disposition (2026-08-31, D-066): partially implemented, as a lower bound and not as the
measurement this section asked for.** `offline._deficient_support` now reports
`deficient_support_mass` and `deficient_support_event_rate` on every `PolicyEstimate`,
`candidate_deficient_support_mass` is a first-class field on the comparison, and
`max_deficient_support_mass` blocks at 2% by default under a 10% absolute ceiling. It counts
only the two situations a *single* record proves, given that a slate's propensities sum to
one: a logged propensity within `min_logged_probability` of 1, which puts every alternative
in that event provably below the floor the config already refuses to divide by; and a
candidate that assigns zero to the logged action, so the one action with an observed reward
is the one action the policy would never take. Ordinary unobserved actions are deliberately
not counted, because a gate that fires on every honest evaluation is a gate nobody reads.

The full quantity this section describes — candidate mass on actions whose logging
probability really was zero — still needs π₀ over the whole slate, which neither the contract
nor the production table records; each stores one propensity, for the action that was logged.
So what is computed is a **provable lower bound on support deficiency, not a measurement of
it**, and a zero means "nothing provable", never "nothing there". `MIN_OVERLAP_RATE_FLOOR`
remains what this section says it is: a real gate against a real failure, but not the
deficient-support gate its name suggests.

---

## 6. Human and clinical framing — this is thin, and I will not pad it

I searched for off-policy evaluation applied to assistive communication, AAC,
accessibility, or disability technology where the reward is a user interaction. **I found
nothing that matches.** The AAC and aphasia literature that exists concerns intervention
efficacy, predictive-authoring quality, and personalisation of speech models — for example
[AAC intervention for in-patient post-stroke aphasia (trial
protocol)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8611624/) and [LLM-integrated AAC
for oncological aphasia
rehabilitation](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10821375/) — but none of it
uses propensity-weighted counterfactual estimation on logged interactions. Conversely the
OPE literature that touches health is about treatment decisions, not communication
interfaces. **There is no prior art for what this scaffold is doing.** That is a reason
for caution, not a claim of novelty worth making anywhere near a patient.

The nearest genuine neighbours, and they are neighbours rather than precedents:

| Work | What it shares with us | What it does not |
|---|---|---|
| [Gottesman et al., Nat Med 2019](https://www.nature.com/articles/s41591-018-0310-5) | Offline evaluation on observational health data; explicit warning against over-reading value estimates | Treatment decisions with clinical outcomes, not UI actions; cohort-scale data |
| [Liao et al., Stat Med 2016](https://onlinelibrary.wiley.com/doi/abs/10.1002/sim.6847) (MRT sample size) | Per-person, per-decision randomisation; proximal proxy outcome; explicit sample size derivation | Requires prospective randomisation on participants — forbidden for us |
| [Offline contextual bandits for mHealth emotion regulation](https://arxiv.org/abs/2008.09472) | Offline bandit on logged digital-health interactions | Multi-user corpus; intervention selection, not candidate ranking |
| [Offline policy evaluation of multi-turn LLM health coaching with real users](https://arxiv.org/abs/2510.17173) | OPE on deployment logs of a conversational health product | Non-impaired users; no confirmation-gate safety invariant |

---

## 7. Reward design: what goes wrong when a UI interaction is the reward

### 7.1 The general result

[Skalse, Howe, Krasheninnikov & Krueger, *Defining and Characterizing Reward Hacking*
(NeurIPS 2022)](https://arxiv.org/abs/2209.13085) give the formal statement and it is
unusually blunt: a proxy is *unhackable* if increasing expected proxy return can never
decrease expected true return, and they show that for the set of all stochastic policies
two reward functions can only be unhackable if one of them is constant. In other words
there is no way to design our way to a safe proxy; the only defences are limiting how hard
the proxy is optimised and limiting the policy class. See also [*Goodhart's Law in
Reinforcement Learning* (ICLR 2024)](https://arxiv.org/abs/2310.09144) for the mechanism
by which proxy–true correlation holds early in optimisation and inverts under pressure.

Our scaffold is unusually well placed to survive this, for a reason worth stating: it does
not optimise the proxy at all. It *compares two externally-produced policies* on it.
Reward hacking is a property of optimisation pressure, and `compare_policies` applies
none. The risk enters the moment anyone uses the comparison result to select among many
candidate policies — at which point the selection itself is the optimisation and the
guarantee is gone.

### 7.2 The specific confound: selection of the top candidate is position-biased

Treating "the patient selected the top candidate" as success is the same measurement error
that the implicit-feedback literature spent fifteen years correcting. [Joachims, Granka,
Pan, Hembrooke & Gay, SIGIR
2005](https://www.cs.cornell.edu/people/tj/publications/joachims_etal_05a.pdf) established
with eye-tracking that clicks are informative but biased, and that *absolute* relevance
judgements from clicks are unreliable while *relative* preferences are reasonably
accurate. [Joachims, Swaminathan & Schnabel, *Unbiased Learning-to-Rank with Biased
Feedback* (WSDM 2017)](https://arxiv.org/abs/1608.04468) turned that into the standard
fix: model the rank-conditional examination probability as a second propensity and
inverse-weight by it.

For us the confound is severe rather than incidental, because **the policy under
evaluation is the ranker**. A candidate policy that reorders the slate changes both the
thing being measured and the presentation bias that contaminates the measurement. The
existing `contracts.LoggedFeedback.top_ranked_action_id` field is the hook a position
propensity would attach to; nothing currently uses it for that.

### 7.3 The population-specific confound: satisficing under effort

This one has no citation I could find and is offered as a design hazard rather than a
literature finding. A user with dysarthria or aphasia pays a real physical and cognitive
cost per interaction. Selecting an adequate-but-wrong candidate to *end* an effortful
exchange is rational behaviour and is indistinguishable, in our schema, from preference.
`RewardConfig`'s deliberate exclusion of latency, dwell, and tap speed is correct on
autonomy grounds — those signals encode disability, not policy quality — but the same
exclusion removes the only signals that could ever separate satisficing from preference.
That tension is not resolvable inside the current contract and should be named in
`LIMITATIONS`.

### 7.4 The phrase-board penalty is a reward-design bug

Trace `rewards.score_logged_action` for an event with `phrase_board_fallback = True` and
no selection: `negative_preference` is True, so `explicit_preference = −1.0`;
`repair_cost` is also `−1.0`; total is `0.8·(−1) + 0.2·(−1) = −1.0`. **Using the phrase
board is the single most negative outcome the reward function can assign** — worse than an
explicit rejection alone (−0.8).

The phrase board is a designed safety fallback. PRD §20 lists "phrase-board fallback" as
the *mitigation* for the device-performance risk, and §22 makes offline phrase-board
operation a condition of done. A reward that scores the safe route as the worst possible
outcome creates exactly the gradient Skalse et al. describe: a policy that suppresses
fallback scores better than one that supports it. Nothing optimises this reward today, so
nothing has exploited it yet. It should be fixed before anything does.

**Disposition (2026-08-31, D-065): fixed.** `repair_cost` is now charged only for
`correction_made`, where the patient engaged with the candidate and then had to repair it,
which is genuine interaction cost. A `phrase_board_fallback` keeps the −1.0 explicit
preference and no repair term, so fallback and rejection both total −0.8 and the safety route
is no longer the global minimum. A correction remains −1.0, and the achievable reward range
is unchanged at [−1.0, +0.8]. This paragraph is the record of how the bug was found: by
tracing the reward by hand for each outcome value while writing this brief. No test failed
and nothing was optimising it, which is precisely why it had survived.

---

## 8. What this means for our code

Ordered by how much it changes what the module should do. Each item names the function,
constant, or gate it lands on. Each row now ends with its **disposition** as of 2026-08-31 —
FIXED, DECLINED with a reason, PARTIAL, or OPEN. A register with no dispositions becomes a
list of things everyone assumes someone else did.

| # | Finding | Lands on | Change |
|---|---|---|---|
| 1 | Phrase-board fallback scores −1.0, the worst outcome available, penalising a designed safety route | `rewards.score_logged_action`, `rewards.RewardConfig` | Separate "fallback" from "rejection". Fallback should be neutral or mildly negative, never the global minimum. This is a correctness bug, not a tuning choice. **FIXED (D-065)** — repair cost now applies only to `correction_made`; fallback and rejection both total −0.8, correction stays −1.0, and the achievable range is unchanged at [−1.0, +0.8]. |
| 2 | `overlap_rate` measures candidate-covers-logger, not logger-covers-candidate; the deficient-support failure mode of [Sachdeva et al.](https://arxiv.org/abs/2006.09438) is undetectable | `offline._estimate` (`overlap_rate`), `MIN_OVERLAP_RATE_FLOOR`, `contracts.LoggedFeedback` | Log π₀ over the **whole slate**, not just the logged action (schema v3), then add an `unsupported_candidate_mass` field and a blocker. Until then, rename the gate to what it measures and state in `LIMITATIONS` that support deficiency is not detected. **PARTIAL (D-066)** — `deficient_support_mass` / `deficient_support_event_rate` are reported per estimate, `candidate_deficient_support_mass` is a field on the comparison, and `max_deficient_support_mass` blocks at 2% (10% ceiling). It is a provable LOWER BOUND, not the measurement: a zero means "nothing provable", not "nothing there". Slate-wide propensities (schema v3) are still unrecorded, so the exact quantity is still not computable. |
| 3 | Zero reward is mid-scale, so unsupported mass is imputed as a benign outcome | `rewards.RewardBreakdown.total` range [−1.0, +0.8] | Either translate the reported reward so 0 is the worst outcome, or document that SNIPS's translation-equivariance is the only thing holding this together and that `ips_reward` does not share it. |
| 4 | `MINIMUM_EFFECT_FLOOR = 0.02` promises resolution ~10× finer than `MIN_EVENTS_FLOOR = 50` / `MIN_EFFECTIVE_SAMPLE_SIZE_FLOOR = 25` can deliver (§2.2) | `offline.MINIMUM_EFFECT_FLOOR`, `EvaluationConfig.__post_init__` | Compute the achievable MDE from the realised ESS in `compare_policies` and block when `minimum_effect` falls below it. Failing that, raise the floor to ≈0.15. **OPEN** — neither has been done. `MINIMUM_EFFECT_FLOOR` is still 0.02 and still promises ~10× the resolution the sample floors deliver. Recorded as an open calibration question in `PLAN_RL.md` and PRD §21; the literature supplies no fixed minimum event count, because the governing quantity is ESS rather than n. |
| 5 | Bootstrap resamples events i.i.d.; events cluster by patient and session; naive bootstrap is anti-conservative under positive intra-cluster correlation | `offline._bootstrap_delta` (`rng.randrange(n)`) | Add an opaque, non-identifying cluster key to `contracts.LoggedFeedback` and resample clusters. If the privacy review forbids it, constrain each comparison to one patient by construction and record session-level clustering as an accepted, signed bias. **DECLINED (D-064)** — a grouping id stable across a speaker's events IS a pseudonymous patient identifier, and the collisions that make it useful are what make it a re-identification handle; no salting separates them. The bias is carried instead: first entry of `LIMITATIONS` with its direction named, repeated in `does_not_guarantee`, named by `UNCERTAINTY_BASIS`, and `clustered_uncertainty_available` is permanently false. |
| 6 | Bootstrap intervals have no finite-sample guarantee — "all methods can do worse than 5% when data is extremely sparse" ([Hanna et al.](https://arxiv.org/abs/1606.06126)) | `offline._bootstrap_delta`, `BOOTSTRAP_REPLICATES_FLOOR`, `CONFIDENCE_LEVEL_FLOOR` | Add a second, conservative bound alongside the bootstrap ([Kuzborskij et al.](https://arxiv.org/abs/2006.10460) SN lower bound, or [Jin et al.](https://arxiv.org/abs/2212.09900) self-normalised empirical Bernstein) and require **both** to clear `minimum_effect`. Raising replicate counts does not fix this; it is a bias, not noise. |
| 7 | SNIPS bias is O(1/n) and is not accounted for anywhere; the interval controls concentration only | `offline._snips`, `_bootstrap_delta` | Same fix as #6 — the SN-specific bounds exist precisely because the bias needs multiplicative control at small n. |
| 8 | `ips_reward == snips_reward * weight_mass` identically; IPS is not an independent diagnostic | `offline._estimate`, module docstring, `PolicyEstimate.ips_reward` | Keep the field, correct the docstring. Do not let a reviewer read agreement between IPS and SNIPS as corroboration. |
| 9 | `MAX_IMPORTANCE_WEIGHT_CEILING = 20` is absolute; at n = 50 one such event is ~40% of `Σw` | `offline.MAX_IMPORTANCE_WEIGHT_CEILING`, `_estimate_blockers` | Make the ceiling relative: block when `max_importance_weight > 0.1 · Σw`, in addition to the absolute cap. |
| 10 | Selection of the top-ranked candidate is position-biased, and the evaluated policy *is* the ranker ([Joachims et al. 2017](https://arxiv.org/abs/1608.04468)) | `contracts.LoggedFeedback.top_ranked_action_id`, `rewards.score_logged_action` | Until a position propensity is estimated, treat the reward as a presentation-confounded proxy and say so in `LIMITATIONS`. Do not add a position model without a randomised source for it — which we do not have. |
| 11 | `ComparisonStatus.inconclusive` is the HCPI *No Solution Found* outcome and is a success of the method | `offline.ComparisonStatus`, `compare_policies` docstring | Document it as such, citing [Thomas et al. 2015](https://proceedings.mlr.press/v37/thomas15.html), so nobody reads a run of inconclusive results as a reason to weaken a gate. |
| 12 | The standard safe criterion is one-sided on a lower bound against a named baseline value | `compare_policies` status logic (`lower > minimum_effect`) | Already essentially correct and paired, which is better than comparing two separate intervals. Keep it; document that `CONFIDENCE_LEVEL_FLOOR = 0.90` two-sided is a 0.95 one-sided bound, which is the HCPI-standard form. **TIGHTENED (D-066)** — the single inequality is replaced by three conditions: interval lower bound over `minimum_effect`, point estimate over it, and survival of deleting the single most influential logged event. Each unmet condition is named on `ImprovementDecision.unmet_conditions`. |
| 13 | Optimisation pressure, not the reward function, is what creates reward hacking ([Skalse et al.](https://arxiv.org/abs/2209.13085)) | `compare_policies` as an API | Add a gate or at minimum a documented rule against using `compare_policies` for selection over many candidate policies. Comparing two named policies is safe; sweeping is not, and nothing in the code currently distinguishes them. |
| 14 | Effort-driven satisficing is indistinguishable from preference in this schema | `rewards.RewardConfig` docstring, `offline.LIMITATIONS` | Add to `LIMITATIONS`. The docstring correctly explains why timing signals are excluded; it should also say what that exclusion costs. |
| 15 | DR / SWITCH / shrinkage all require a reward model; fitting one on the same tiny log is leakage | PRD §11, absence of a DR path in `offline.py` | No change. The current deferral is correct and this brief endorses it. **SUPERSEDED (D-066)** — a DR path now exists but is unreachable without a `ValidatedOutcomeModel`, which cannot be constructed without a six-field `OutcomeModelValidation` with no defaults; `gate_outcome_model` refuses a non-grouped split, a model fitted on the evaluation events, a holdout under 50, or calibration error above 0.25. Request and model must both be supplied or the whole comparison blocks. SNIPS stays the headline through a read-only property, and the DR result's `role` is read-only `secondary_diagnostic_only`. The deferral this row endorsed is now enforced by types rather than by absence. |

Items 1, 2, and 4 are the ones that change what a passing comparison *means*. The rest
tighten or document.

Item 4 is the only one of the three still open, and it is the one most likely to be forgotten
because nothing fails because of it. Items 6, 7, 8, 9, 10, 13 and 14 have not been acted on
either, and are recorded here as still open rather than restated elsewhere.

---

## 9. Open questions the literature does not answer for us

Stated plainly, because the gap between the papers and our situation is large enough that
pretending otherwise would be the main risk this document introduces.

**Single patient.** Every estimator, bound, and diagnostic cited here is derived for
i.i.d. draws from a context distribution. A per-patient corpus is one realisation of one
person's communication over time — non-stationary (recovery, fatigue, medication, mood),
serially correlated, and with a context distribution that drifts as the patient learns the
interface. The cluster-bootstrap literature (§3.2) tells us to resample the cluster; it
does not tell us what to do when there is exactly one cluster. **We do not have a
principled interval for n = 1 patient, and no paper found here supplies one.**

**Tiny n.** The asymptotic results (SNIPS consistency, DR efficiency, minimax rates) are
all statements about large n. The finite-sample results (empirical Bernstein, Efron–Stein,
HCOPE) are honest at small n but, by the authors' own admission, too loose to be useful
there. We are in the band where the tight tools are invalid and the valid tools are
vacuous. §2.2 quantifies that band for our constants; nothing in the literature closes it.

**Proxy reward.** Skalse et al. prove that no non-trivial proxy is unhackable, and the
implicit-feedback literature tells us how to de-bias clicks *when you can randomise the
presentation*. We cannot. So we have a proxy known to be biased, no way to estimate the
bias, and a population for whom the standard interpretation of the proxy (selection ⇒
preference) is weakest. There is no literature on selection-as-preference for post-stroke
AAC users; §6 says so and this section repeats it because it is the load-bearing unknown.

**No online exploration, ever.** Nearly every method reviewed here assumes an eventual
online check — DR validates q̂ against reality, offline A/B estimators are benchmarked
against online A/B tests ([Gilotte et al., WSDM 2018](https://arxiv.org/abs/1801.07030)
explicitly "show their correlation with business metrics observed by running online A/B
tests"), and safe policy improvement assumes a deployment step that closes the loop. **We
have permanently removed the step that validates the estimate.** An offline number that
will never be checked against reality is a different epistemic object from one that will
be, and the literature does not address the difference. This is the strongest argument for
the module's existing posture — `deployment_allowed`, `online_experiment_allowed`, and
`clinical_claim_allowed` as read-only `False` properties — and for keeping the output as
evidence for human review rather than as an answer.

**Where the propensities come from.** PLAN_RL step 2 asks us to "document how propensities
are produced without live random exploration". Nothing in this brief answers it. Every
cited method requires a known, non-degenerate π₀; `compare_policies` correctly refuses a
deterministic log via `logging_policy_is_deterministic`. But refusing bad logs is not the
same as having a way to produce good ones, and a randomised ranker shown to a patient is a
product decision with clinical-safety consequences that no OPE paper is qualified to make
for us.

*Answered by product decision, not by literature (2026-08-31, D-063).* The premise of the
step turned out to be wrong: there is no way to produce usable propensities without
randomisation, so a bounded randomisation was adopted rather than avoided — near-ties within
0.05 only, at most two alternatives at 0.08 each, top keeping ≥0.84, confirmation path only.
That is a clinical-safety judgement about a patient-facing surface, made by this project and
recorded as a decision, and nothing in this brief licenses it. The literature's contribution
was only the negative result: without randomisation there is nothing to estimate.

**How often a real slate is near-tied.** The whole design assumes near-ties are common enough
that a randomised log accumulates. If they are not, more than 10% of events carry probability
1.0 and `logging_policy_is_deterministic` refuses the entire log. No paper can tell us the
near-tie rate of an Awaaz slate and no measurement of it exists. It is the first quantity that
should be read off the log once anything writes to it.

---

## Bibliography

Ordered as first cited.

- Horvitz, D. G. & Thompson, D. J. (1952). A generalization of sampling without
  replacement from a finite universe. *JASA* 47(260):663–685.
  <https://doi.org/10.1080/01621459.1952.10483446>
- Swaminathan, A. & Joachims, T. (2015). Counterfactual Risk Minimization. *ICML*.
  <https://proceedings.mlr.press/v37/swaminathan15.html>
- Swaminathan, A. & Joachims, T. (2015). The Self-Normalized Estimator for Counterfactual
  Learning. *NeurIPS*.
  <https://proceedings.neurips.cc/paper/2015/hash/39027dfad5138c9ca0c474d71db915c3-Abstract.html>
- Dudík, M., Langford, J. & Li, L. (2011). Doubly Robust Policy Evaluation and Learning.
  *ICML*. <https://arxiv.org/abs/1103.4601>
- Wang, Y.-X., Agarwal, A. & Dudík, M. (2017). Optimal and Adaptive Off-policy Evaluation
  in Contextual Bandits. *ICML*. <https://proceedings.mlr.press/v70/wang17a.html>
- Su, Y., Dimakopoulou, M., Krishnamurthy, A. & Dudík, M. (2020). Doubly Robust Off-policy
  Evaluation with Shrinkage. *ICML*. <https://proceedings.mlr.press/v119/su20a.html>
- Sachdeva, N., Su, Y. & Joachims, T. (2020). Off-policy Bandits with Deficient Support.
  *KDD*. <https://arxiv.org/abs/2006.09438>
- Kuzborskij, I., Vernade, C., György, A. & Szepesvári, C. (2021). Confident Off-Policy
  Evaluation and Selection through Self-Normalized Importance Weighting. *AISTATS*.
  <https://arxiv.org/abs/2006.10460>
- Maurer, A. & Pontil, M. (2009). Empirical Bernstein Bounds and Sample Variance
  Penalization. *COLT*. <https://arxiv.org/abs/0907.3740>
- Thomas, P., Theocharous, G. & Ghavamzadeh, M. (2015). High-Confidence Off-Policy
  Evaluation. *AAAI*. <https://ojs.aaai.org/index.php/AAAI/article/view/9541>
- Thomas, P., Theocharous, G. & Ghavamzadeh, M. (2015). High Confidence Policy
  Improvement. *ICML*. <https://proceedings.mlr.press/v37/thomas15.html>
- Hanna, J. P., Stone, P. & Niekum, S. (2017). Bootstrapping with Models: Confidence
  Intervals for Off-Policy Evaluation. <https://arxiv.org/abs/1606.06126>
- Li, L., Chu, W., Langford, J. & Wang, X. (2011). Unbiased Offline Evaluation of
  Contextual-bandit-based News Article Recommendation Algorithms. *WSDM*.
  <https://arxiv.org/abs/1003.5956>
- Gilotte, A., Calauzènes, C., Nedelec, T., Abraham, A. & Dollé, S. (2018). Offline A/B
  testing for Recommender Systems. *WSDM*. <https://arxiv.org/abs/1801.07030>
- Elvira, V., Martino, L. & Robert, C. P. Rethinking the Effective Sample Size.
  *International Statistical Review*. <https://arxiv.org/abs/1809.04129>
- Jin, Y., Ren, Z., Yang, Z. & Wang, Z. (2022). Policy learning "without" overlap:
  Pessimism and generalized empirical Bernstein's inequality.
  <https://arxiv.org/abs/2212.09900>
- Waudby-Smith, I., Wu, L., Ramdas, A., Karampatziakis, N. & Mineiro, P. (2024).
  Anytime-valid off-policy inference for contextual bandits. *ACM/IMS JDS*.
  <https://arxiv.org/abs/2210.10768>
- Laroche, R., Trichelair, P. & Tachet des Combes, R. (2019). Safe Policy Improvement with
  Baseline Bootstrapping. *ICML*.
  <http://proceedings.mlr.press/v97/laroche19a/laroche19a.pdf>
- Deen, M. & de Rooij, M. (2020). ClusterBootstrap: An R package for the analysis of
  hierarchical data using generalized linear models with the cluster bootstrap. *Behavior
  Research Methods*. <https://link.springer.com/article/10.3758/s13428-019-01252-y>
- Cheng, G., Yu, Z. & Huang, J. Z. (2013). The cluster bootstrap consistency in
  generalized estimating equations. *JMVA*.
  <https://www.sciencedirect.com/science/article/pii/S0047259X12002175>
- Clustering Context in Off-Policy Evaluation (2025). <https://arxiv.org/abs/2502.21304>
- Off-Policy Evaluation with Deficient Support Using Side Information (2022). *NeurIPS*.
  <https://proceedings.neurips.cc/paper_files/paper/2022/file/c32be49c09eec3aad1f2bb587543e7f6-Paper-Conference.pdf>
- Gottesman, O., Johansson, F., Komorowski, M., Faisal, A., Sontag, D., Doshi-Velez, F. &
  Celi, L. A. (2019). Guidelines for reinforcement learning in healthcare. *Nature
  Medicine* 25:16–18. <https://www.nature.com/articles/s41591-018-0310-5>
- Liao, P., Klasnja, P., Tewari, A. & Murphy, S. A. (2016). Sample size calculations for
  micro-randomized trials in mHealth. *Statistics in Medicine*.
  <https://onlinelibrary.wiley.com/doi/abs/10.1002/sim.6847> ·
  <https://arxiv.org/abs/1504.00238>
- Klasnja, P. et al. (2023). Microrandomized Trials: Developing Just-in-Time Adaptive
  Interventions for Better Public Health. *AJPH*.
  <https://ajph.aphapublications.org/doi/full/10.2105/AJPH.2022.307150>
- Offline Contextual Multi-armed Bandits for Mobile Health Interventions: A Case Study on
  Emotion Regulation (2020). <https://arxiv.org/abs/2008.09472>
- Offline Policy Evaluation of Multi-Turn LLM Health Coaching with Real Users (2025).
  <https://arxiv.org/abs/2510.17173>
- Joachims, T., Granka, L., Pan, B., Hembrooke, H. & Gay, G. (2005). Accurately
  Interpreting Clickthrough Data as Implicit Feedback. *SIGIR*.
  <https://www.cs.cornell.edu/people/tj/publications/joachims_etal_05a.pdf>
- Joachims, T., Swaminathan, A. & Schnabel, T. (2017). Unbiased Learning-to-Rank with
  Biased Feedback. *WSDM*. <https://arxiv.org/abs/1608.04468>
- Skalse, J., Howe, N. H. R., Krasheninnikov, D. & Krueger, D. (2022). Defining and
  Characterizing Reward Hacking. *NeurIPS*. <https://arxiv.org/abs/2209.13085>
- Goodhart's Law in Reinforcement Learning (2024). *ICLR*.
  <https://arxiv.org/abs/2310.09144>
- AAC intervention for in-patient individuals with post-stroke aphasia (trial protocol).
  <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8611624/>
- Integration of a large language model with an AAC tool for oncological aphasia
  rehabilitation. <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10821375/>
