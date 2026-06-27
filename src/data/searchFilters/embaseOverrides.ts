import type { FilterBlock, StrandId } from "../../search/types.js";
import { SIGN_PAGE_URL } from "./signCatalog.js";

/**
 * Colleague-supplied Embase single-line strand filters (design-log #44 fixtures).
 * Used for licensed Embase runs where teams prefer house syntax over SIGN's shorter blocks.
 */
const EMBASE_STRAND_OVERRIDES: Partial<Record<StrandId, string>> = {
  economic: `'economics'/exp OR 'cost'/exp OR 'cost benefit analysis'/exp OR 'cost control'/exp OR 'cost of illness'/exp OR 'health care cost'/exp OR 'drug cost'/exp OR 'hospital cost'/exp OR 'socioeconomics'/exp OR 'health economics'/exp OR 'pharmacoeconomics'/exp OR 'budget'/exp OR 'fee'/exp OR 'economic evaluation'/exp OR 'cost effectiveness analysis'/exp OR 'cost utility analysis'/exp OR 'cost minimization analysis'/exp OR 'economic aspect'/exp OR 'financial management'/exp OR 'health care financing'/exp OR ((low NEXT/1 cost*):ab,ti) OR ((high NEXT/1 cost*):ab,ti) OR ((healthcare NEXT/1 cost*):ab,ti) OR fiscal:ab,ti OR funding:ab,ti OR financial:ab,ti OR finance:ab,ti OR ((cost NEAR/2 estimate*):ab,ti) OR ((cost NEAR/2 variable*):ab,ti) OR ((unit NEAR/2 cost*):ab,ti) OR economic*:ab,ti OR pharmacoeconomic*:ab,ti OR price*:ab,ti OR pricing:ab,ti OR 'cost effectiveness':ab,ti OR 'cost utility':ab,ti OR cea:ab,ti OR cua:ab,ti OR markov:ab,ti OR ((decision NEXT/2 tree*):ab,ti) OR ((decision NEXT/2 analysis*):ab,ti) OR ((monte NEXT/1 carlo):ab,ti) OR 'quality adjusted life year'/exp OR 'decision tree'/exp OR 'monte carlo method'/exp OR 'hidden markov model'/exp OR 'sensitivity analysis'/exp OR (((incremental OR qaly OR 'quality adjusted life years') NEAR/3 cost):ab,ti) OR ((cost NEAR/3 (effect* OR utility* OR benefit OR conseq* OR minimi* OR increment* OR qaly* OR ly* OR 'quality adjusted life year*' OR 'life year*')):ab,ti) OR icer:ab,ti OR qaly:ab,ti OR 'quality adjusted life year*':ab,ti OR 'life year*':ab,ti OR (((markov* OR simulat* OR decisio* OR analy* OR 'area under curve' OR partition* OR survival* OR economic*) NEAR/2 model*):ab,ti)`,
  hrqol: `'quality of life'/exp OR qol:ab,ti OR ((quality NEXT/2 life):ab,ti) OR 'value of life'/exp OR ((value NEXT/2 (money OR monetary)):ab,ti) OR 'life quality':ab,ti OR 'life qualities':ab,ti OR 'utility':ab,ti OR 'utilities':ab,ti OR 'disutility':ab,ti OR 'disutilities':ab,ti OR 'well being':ab,ti OR 'wellbeing':ab,ti OR 'quality adjusted life year'/exp OR 'quality adjusted life':ab,ti OR qaly*:ab,ti OR qald*:ab,ti OR qale*:ab,ti OR qtime*:ab,ti OR 'disability adjusted life year':ab,ti OR 'disability adjusted life years':ab,ti OR daly*:ab,ti OR 'questionnaire'/exp OR 'health survey'/exp OR 'health status'/exp OR 'health status indicator'/exp OR 'self report'/exp OR sf36:ab,ti OR 'sf 36':ab,ti OR 'short form 36':ab,ti OR 'shortform 36':ab,ti OR 'sf thirtysix':ab,ti OR 'sf thirty six':ab,ti OR 'shorform thirtysix':ab,ti OR 'shortform thirty six':ab,ti OR 'short form thirtysix':ab,ti OR 'short form thirty six':ab,ti OR 'sf 6':ab,ti OR sf6:ab,ti OR 'short form 6':ab,ti OR 'shortform 6':ab,ti OR 'sf six':ab,ti OR sfsix:ab,ti OR 'shortform six':ab,ti OR 'short form six':ab,ti OR sf12:ab,ti OR 'sf 12':ab,ti OR 'short form 12':ab,ti OR 'shortform 12':ab,ti OR 'sf twelve':ab,ti OR sftwelve:ab,ti OR 'shortform twelve':ab,ti OR 'short form twelve':ab,ti OR sf16:ab,ti OR 'sf 16':ab,ti OR 'short form 16':ab,ti OR 'shortform 16':ab,ti OR 'sf sixteen':ab,ti OR sfsixteen:ab,ti OR 'shortfrom sixteen':ab,ti OR 'short form sixteen':ab,ti OR sf20:ab,ti OR 'sf 20':ab,ti OR 'short form 20':ab,ti OR 'shortform 20':ab,ti OR 'sf twenty':ab,ti OR sftwenty:ab,ti OR 'shortform twenty':ab,ti OR 'short form twenty':ab,ti OR euroqol:ab,ti OR 'euro qol':ab,ti OR 'euroqol 5d':ab,ti OR 'euroqol-5d':ab,ti OR 'euroqol 5-d':ab,ti OR eq5d:ab,ti OR 'eq 5d':ab,ti OR hql:ab,ti OR hrql:ab,ti OR hqol:ab,ti OR 'h qol':ab,ti OR hrqol:ab,ti OR 'hr qol':ab,ti OR 'health* year* equivalent*':ab,ti OR hye:ab,ti OR hyes:ab,ti OR 'health utilities index':ab,ti OR hui:ab,ti OR hui1:ab,ti OR hui2:ab,ti OR 'hui-2':ab,ti OR hui3:ab,ti OR 'hui-3':ab,ti OR rosser:ab,ti OR ((quality NEXT/2 (wellbeing OR 'well being')):ab,ti) OR qwb:ab,ti OR ((willingness NEXT/2 pay):ab,ti) OR wtp:ab,ti OR ((patient NEAR/1 report*):ab,ti) OR 'standard gamble*':ab,ti OR ((standard NEXT/1 gamble*):ab,ti) OR 'time trade off':ab,ti OR 'time tradeoff':ab,ti OR tto:ab,ti OR 'fatigue impact scale':ab,ti OR 'visual analogue scale':ab,ti OR 'vas':ab,ti OR 'visual analogue scale 10':ab,ti OR 'vas10':ab,ti OR 'vas 10':ab,ti OR 'grade scale':ab,ti OR 'sickness impact profile':ab,ti OR 'grogono-woodgate health index':ab,ti OR 'grogono-woodgate index':ab,ti OR 'grogono woodgate':ab,ti OR 'gw index':ab,ti OR 'psychological general well being':ab,ti OR 'psychological well being':ab,ti OR 'psychological wellbeing':ab,ti OR 'functional capacity':ab,ti OR 'frailty':ab,ti OR 'activity scales':ab,ti`,
  epidemiology: `'epidemiology':ab,ti OR 'prevalence':ab,ti OR 'incidence':ab,ti OR 'risk factor':ab,ti OR 'comorbidity':ab,ti OR 'survival rate':ab,ti OR 'mortality':ab,ti OR 'disease course':ab,ti OR 'recurrent disease':ab,ti OR 'natural history':ab,ti OR 'symptom assessment':ab,ti OR ((health NEAR/3 assessment):ab,ti) OR 'epidemiology'/de OR 'prevalence'/de OR 'incidence'/de OR 'risk factor'/de OR 'comorbidity'/de OR 'survival rate'/de OR 'mortality'/de OR 'disease course'/de OR 'recurrent disease'/de OR 'symptom assessment'/de`,
};

export function getEmbaseStrandOverride(strand: StrandId): string | undefined {
  return EMBASE_STRAND_OVERRIDES[strand];
}

export function getEmbaseOverrideBlock(strand: StrandId): FilterBlock | undefined {
  const line = EMBASE_STRAND_OVERRIDES[strand];
  if (!line) return undefined;
  return {
    id: `embase-override-${strand}`,
    strand,
    database: "embase",
    lines: [line],
    provenance: {
      source: "Colleague-supplied Embase strand filter (design-log #44 fixture)",
      url: SIGN_PAGE_URL,
      citation:
        "HEORAgent validated Embase strategy fixture — see design-log #44 Examples.",
    },
  };
}