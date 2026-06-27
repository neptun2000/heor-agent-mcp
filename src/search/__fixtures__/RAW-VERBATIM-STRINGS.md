# Verbatim Embase strategy strings (colleague-supplied) — source of truth for the filter library + fixtures

These are REAL Embase search strings with REAL hit counts. Transcribe them **byte-for-byte** into
the filter library (`src/data/searchFilters/`) and fixtures (`src/search/__fixtures__/`). Do not
"clean up" operators, quotes, or spacing. The golden tests assert exact equality and fail until the
paste is identical. (This .md file is reference-only; delete it once the .ts fixtures are populated,
or keep it as provenance.)

---

## FIXTURE 1 — Adrenal insufficiency / CAH · COST & RESOURCE USE · pediatric · 2007-2017

**#1 concept line A (adrenal insufficiency)** — hits 26,906
```
'adrenal cortex insufficiency'/exp OR 'adrenal insufficiency'/exp OR 'addison disease'/exp OR 'adrenal cortex atrophy'/exp OR (((adrenal* OR adrenocortic* OR hypothalam*pituitary* OR 'hpa ax?s' OR 'hpaax?s' OR 'hpa-ax?s' OR cortisol) NEAR/2 (insufficienc* OR hypofunction OR disorder* OR failure* OR dysfunction*)):ab,ti) OR hypoadrenalism:ab,ti OR 'addison* disease':ab,ti
```

**#2 concept line B (CAH)** — hits 9,539
```
'congenital adrenal hyperplasia'/exp OR 'congenital adrenal hyperplasia due to 21 hydroxylase deficiency' OR 'congenital adrenal hyperplasia due to 11-beta-hydroxylase deficiency' OR 'congenital adrenal hyperplasia due to 11 beta-hydroxylase deficiency' OR 'congenital adrenal hyperplasia due to 11beta-hydroxylase deficiency' OR 'congenital adrenal hyperplasia due to 11betahydroxylase deficiency' OR 'congenital adrenal hyperplasia due to 11 beta hydroxylase deficiency' OR 'congenital adrenal hyperplasia':ab,ti OR 'congenital adrenal hyperplasias':ab,ti OR 'adrenogenital syndrome':ab,ti OR 'adrenogenital syndromes':ab,ti
```

**#3** = `#1 OR #2` — hits 35,349

**#4 ECONOMIC strand filter** — hits 2,082,021
```
'economics'/exp OR 'cost'/exp OR 'cost benefit analysis'/exp OR 'cost control'/exp OR 'cost of illness'/exp OR 'health care cost'/exp OR 'drug cost'/exp OR 'hospital cost'/exp OR 'socioeconomics'/exp OR 'health economics'/exp OR 'pharmacoeconomics'/exp OR 'budget'/exp OR 'fee'/exp OR 'economic evaluation'/exp OR 'cost effectiveness analysis'/exp OR 'cost utility analysis'/exp OR 'cost minimization analysis'/exp OR 'economic aspect'/exp OR 'financial management'/exp OR 'health care financing'/exp OR ((low NEXT/1 cost*):ab,ti) OR ((high NEXT/1 cost*):ab,ti) OR ((healthcare NEXT/1 cost*):ab,ti) OR fiscal:ab,ti OR funding:ab,ti OR financial:ab,ti OR finance:ab,ti OR ((cost NEAR/2 estimate*):ab,ti) OR ((cost NEAR/2 variable*):ab,ti) OR ((unit NEAR/2 cost*):ab,ti) OR economic*:ab,ti OR pharmacoeconomic*:ab,ti OR price*:ab,ti OR pricing:ab,ti OR 'cost effectiveness':ab,ti OR 'cost utility':ab,ti OR cea:ab,ti OR cua:ab,ti OR markov:ab,ti OR ((decision NEXT/2 tree*):ab,ti) OR ((decision NEXT/2 analysis*):ab,ti) OR ((monte NEXT/1 carlo):ab,ti) OR 'quality adjusted life year'/exp OR 'decision tree'/exp OR 'monte carlo method'/exp OR 'hidden markov model'/exp OR 'sensitivity analysis'/exp OR (((incremental OR qaly OR 'quality adjusted life years') NEAR/3 cost):ab,ti) OR ((cost NEAR/3 (effect* OR utility* OR benefit OR conseq* OR minimi* OR increment* OR qaly* OR ly* OR 'quality adjusted life year*' OR 'life year*')):ab,ti) OR icer:ab,ti OR qaly:ab,ti OR 'quality adjusted life year*':ab,ti OR 'life year*':ab,ti OR (((markov* OR simulat* OR decisio* OR analy* OR 'area under curve' OR partition* OR survival* OR economic*) NEAR/2 model*):ab,ti)
```

**#5** = `#3 AND #4` — hits 885

**#6 EXCLUSION (single-line form)** — hits 11,284,249
```
'case study':it OR 'case report':it OR 'abstract report':it OR 'editorial':it OR 'letter':it OR 'note':it OR 'case study'/exp OR 'case report'/exp OR 'abstract report'/exp OR 'editorial'/exp OR 'letter'/exp OR 'note'/exp OR ('animal'/exp NOT ('animal'/exp AND 'human'/exp)) OR ((review:it OR 'review literature as topic'/exp OR 'literature review':it) NOT ('meta-analysis':it OR 'meta-analysis as topic'/mj OR 'systematic review':ti OR 'systematic literature review':ti OR 'meta-analysis':ab,ti OR 'meta analysis':ab,ti))
```

**#7** = `#5 NOT #6` — hits 489

**#8 AGE LIMIT — pediatric** — hits 8,344,909
```
baby:ab,ti OR babies:ab,ti OR newborn*:ab,ti OR neonat*:ab,ti OR toddler*:ab,ti OR child*:ab,ti OR preschool*:ab,ti OR schoolchild*:ab,ti OR boy*:ab,ti OR girl*:ab,ti OR 'pre school*':ab,ti OR pediatr*:ab,ti OR paediatr*:ab,ti OR prematur*:ab,ti OR 'pre matur*':ab,ti OR preterm*:ab,ti OR 'pre term*':ab,ti OR 'pre-term*':ab,ti OR nursery*:ab,ti OR 'child'/exp OR 'newborn'/exp OR 'infant'/exp OR 'preschool'/exp OR 'school'/exp OR 'adolescent'/exp OR 'child'/syn OR 'newborn'/syn OR 'infant'/syn OR 'preschool'/syn OR 'school'/syn OR 'adolescent'/syn OR teen*:ab,ti OR adolescent*:ab,ti OR infant*:ab,ti OR school*:ab,ti
```

**#9** = `#7 AND #8` — hits 272
**#10** = `#9 AND [2007-2017]/py` — hits 183

---

## FIXTURE 2 — Adrenal insufficiency / CAH · HRQoL & UTILITY · pediatric

Concept #1, #2, #3 — IDENTICAL to Fixture 1 (reuse the same strings).

**#4 HRQoL / UTILITY strand filter** — hits 1,848,080
```
'quality of life'/exp OR qol:ab,ti OR ((quality NEXT/2 life):ab,ti) OR 'value of life'/exp OR ((value NEXT/2 (money OR monetary)):ab,ti) OR 'life quality':ab,ti OR 'life qualities':ab,ti OR 'utility':ab,ti OR 'utilities':ab,ti OR 'disutility':ab,ti OR 'disutilities':ab,ti OR 'well being':ab,ti OR 'wellbeing':ab,ti OR 'quality adjusted life year'/exp OR 'quality adjusted life':ab,ti OR qaly*:ab,ti OR qald*:ab,ti OR qale*:ab,ti OR qtime*:ab,ti OR 'disability adjusted life year':ab,ti OR 'disability adjusted life years':ab,ti OR daly*:ab,ti OR 'questionnaire'/exp OR 'health survey'/exp OR 'health status'/exp OR 'health status indicator'/exp OR 'self report'/exp OR sf36:ab,ti OR 'sf 36':ab,ti OR 'short form 36':ab,ti OR 'shortform 36':ab,ti OR 'sf thirtysix':ab,ti OR 'sf thirty six':ab,ti OR 'shorform thirtysix':ab,ti OR 'shortform thirty six':ab,ti OR 'short form thirtysix':ab,ti OR 'short form thirty six':ab,ti OR 'sf 6':ab,ti OR sf6:ab,ti OR 'short form 6':ab,ti OR 'shortform 6':ab,ti OR 'sf six':ab,ti OR sfsix:ab,ti OR 'shortform six':ab,ti OR 'short form six':ab,ti OR sf12:ab,ti OR 'sf 12':ab,ti OR 'short form 12':ab,ti OR 'shortform 12':ab,ti OR 'sf twelve':ab,ti OR sftwelve:ab,ti OR 'shortform twelve':ab,ti OR 'short form twelve':ab,ti OR sf16:ab,ti OR 'sf 16':ab,ti OR 'short form 16':ab,ti OR 'shortform 16':ab,ti OR 'sf sixteen':ab,ti OR sfsixteen:ab,ti OR 'shortfrom sixteen':ab,ti OR 'short form sixteen':ab,ti OR sf20:ab,ti OR 'sf 20':ab,ti OR 'short form 20':ab,ti OR 'shortform 20':ab,ti OR 'sf twenty':ab,ti OR sftwenty:ab,ti OR 'shortform twenty':ab,ti OR 'short form twenty':ab,ti OR euroqol:ab,ti OR 'euro qol':ab,ti OR 'euroqol 5d':ab,ti OR 'euroqol-5d':ab,ti OR 'euroqol 5-d':ab,ti OR eq5d:ab,ti OR 'eq 5d':ab,ti OR hql:ab,ti OR hrql:ab,ti OR hqol:ab,ti OR 'h qol':ab,ti OR hrqol:ab,ti OR 'hr qol':ab,ti OR 'health* year* equivalent*':ab,ti OR hye:ab,ti OR hyes:ab,ti OR 'health utilities index':ab,ti OR hui:ab,ti OR hui1:ab,ti OR hui2:ab,ti OR 'hui-2':ab,ti OR hui3:ab,ti OR 'hui-3':ab,ti OR rosser:ab,ti OR ((quality NEXT/2 (wellbeing OR 'well being')):ab,ti) OR qwb:ab,ti OR ((willingness NEXT/2 pay):ab,ti) OR wtp:ab,ti OR ((patient NEAR/1 report*):ab,ti) OR 'standard gamble*':ab,ti OR ((standard NEXT/1 gamble*):ab,ti) OR 'time trade off':ab,ti OR 'time tradeoff':ab,ti OR tto:ab,ti OR 'fatigue impact scale':ab,ti OR 'visual analogue scale':ab,ti OR 'vas':ab,ti OR 'visual analogue scale 10':ab,ti OR 'vas10':ab,ti OR 'vas 10':ab,ti OR 'grade scale':ab,ti OR 'sickness impact profile':ab,ti OR 'grogono-woodgate health index':ab,ti OR 'grogono-woodgate index':ab,ti OR 'grogono woodgate':ab,ti OR 'gw index':ab,ti OR 'psychological general well being':ab,ti OR 'psychological well being':ab,ti OR 'psychological wellbeing':ab,ti OR 'functional capacity':ab,ti OR 'frailty':ab,ti OR 'activity scales':ab,ti
```

**#5** = `#3 AND #4` — hits 1,649
Exclusion **#6** — IDENTICAL to Fixture 1 (single-line form).
**#7** = `#5 NOT #6` — hits 1,003
Age limit **#8** — IDENTICAL to Fixture 1 (pediatric).
**#9** = `#7 AND #8` — hits 544
(no date line)

---

## FIXTURE 3 — ABSSSI · EPIDEMIOLOGY · 2012-2017 · english

**Concept block — 9 lines (#1–#9), combined at #10 = `#1 OR #2 OR #3 OR #4 OR #5 OR #6 OR #7 OR #8 OR #9` (97,062)**

**#1** — 73,265
```
'acute bacterial skin and skin structure infection'/exp OR 'bacterial skin disease'/exp
```
**#2** — 5,098
```
'staphylococcal skin infection'/exp
```
**#3** — 22,495
```
'cellulitis'/exp OR 'erysipelas'/exp OR 'skin abscess'/exp
```
**#4** — 816
```
((acute OR complicated OR complex) NEAR/2 (skin OR 'soft tissue*' OR 'connective tissue*' OR cutaneous OR wound* OR lacerat* OR burn* OR surg* OR ulcer* OR incision* OR bite OR bites OR biting OR abscess*) NEAR/2 infect*):ab,ti
```
**#5** — 13,949
```
cellulitis:ab,ti OR phlegmon:ab,ti OR erysipelas:ab,ti
```
**#6** — 675
```
((acute OR complicated OR complex) NEAR/2 (staphylococc* OR mrsa OR mssa)):ab,ti
```
**#7** — 1,715
```
((skin OR cutaneous OR 'soft tissue*' OR 'connective tissue*') NEAR/2 abscess*):ab,ti
```
**#8** — 1,582
```
csssi:ab,ti OR csssis:ab,ti OR absssi:ab,ti OR absssis:ab,ti OR ssti:ab,ti OR sstis:ab,ti
```
**#9** — 1,319
```
('skin structure*' NEAR/2 infect*):ab,ti
```

**#11 EPIDEMIOLOGY strand filter** — hits 4,013,296
```
'epidemiology':ab,ti OR 'prevalence':ab,ti OR 'incidence':ab,ti OR 'risk factor':ab,ti OR 'comorbidity':ab,ti OR 'survival rate':ab,ti OR 'mortality':ab,ti OR 'disease course':ab,ti OR 'recurrent disease':ab,ti OR 'natural history':ab,ti OR 'symptom assessment':ab,ti OR ((health NEAR/3 assessment):ab,ti) OR 'epidemiology'/de OR 'prevalence'/de OR 'incidence'/de OR 'risk factor'/de OR 'comorbidity'/de OR 'survival rate'/de OR 'mortality'/de OR 'disease course'/de OR 'recurrent disease'/de OR 'symptom assessment'/de
```

**#12** = `#10 AND #11` — hits 19,776

**EXCLUSION (multi-line form) — 4 lines (#13–#16), combined at #17 = `#13 OR #14 OR #15 OR #16` (13,585,580)**

**#13** — 4,895,012
```
letter:it OR editorial:it OR note:it OR 'conference abstract':it
```
**#14** — 2,414,190
```
(review:it OR 'review literature as topic'/exp OR 'literature review':ti) NOT ('meta-analysis':it OR 'meta-analysis as topic'/mj OR 'systematic review':ti OR 'systematic literature review':ti OR 'meta-analysis':ab,ti OR 'meta analysis':ab,ti)
```
**#15** — 4,906,799
```
'animal'/exp NOT ('animal'/exp AND 'human'/exp)
```
**#16** — 2,351,401
```
'case report'/exp OR 'case report*':ab,ti OR 'case series':ab,ti
```

**#18** = `#12 NOT #17` — hits 10,012
**#19** = `#18 AND [2012-2017]/py` — hits 3,203
**#20** = `#19 AND [english]/lim` — hits 3,057
