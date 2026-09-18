/**
 * Eligibility signal.
 *
 * In production this is Paytm's own underwriting, built on real repayment and
 * bureau data — we are explicitly not reproducing it. What we do here is show
 * that the number has a *traceable origin*: five behavioural components, each
 * derived from the ledger, each carrying the sentence that explains it.
 *
 * Read it as "how confident are we this user can carry new credit", not as a
 * credit score.
 */

import type { BehaviouralFeatures, SignalComponent } from '../types';
import { formatINR } from '../format';
import { clamp, round } from '../math';
export interface EligibilitySignal {
  score: number;
  breakdown: SignalComponent[];
}

export function deriveEligibilitySignal(features: BehaviouralFeatures): EligibilitySignal {
  const breakdown: SignalComponent[] = [];

  // 1. Income stability — is there a salary, and does it land predictably?
  const incomeMax = 25;
  const incomePresence = features.avgMonthlyInflow > 0 ? 1 : 0;
  const incomeValue = incomePresence * (0.5 + 0.5 * features.inflowRegularity);
  breakdown.push({
    id: 'INCOME_STABILITY',
    label: 'Income stability',
    points: round(incomeValue * incomeMax),
    max: incomeMax,
    detail:
      features.avgMonthlyInflow > 0
        ? `Salary credit of ${formatINR(features.avgMonthlyInflow)}/month detected, arriving on a ${
            features.inflowRegularity > 0.7 ? 'predictable' : 'variable'
          } date`
        : 'No recurring salary credit detected in the history',
  });

  // 2. Repayment track record — the strongest predictor we have.
  const repaymentMax = 25;
  const depth = clamp(features.priorCreditRepayments / 6);
  const repaymentValue = depth * features.onTimeRepaymentRate;
  breakdown.push({
    id: 'REPAYMENT_RECORD',
    label: 'Repayment track record',
    points: round(repaymentValue * repaymentMax),
    max: repaymentMax,
    detail:
      features.priorCreditRepayments > 0
        ? `${features.priorCreditRepayments} prior credit cycles, ${Math.round(
            features.onTimeRepaymentRate * 100,
          )}% repaid on time`
        : 'No prior credit history with Paytm',
  });

  // 3. Obligation headroom — how much of income is already committed.
  const headroomMax = 20;
  const commitmentRatio =
    features.avgMonthlyInflow > 0 ? features.fixedMonthlyOutflow / features.avgMonthlyInflow : 1;
  const headroomValue = clamp(1 - commitmentRatio / 0.6);
  breakdown.push({
    id: 'OBLIGATION_HEADROOM',
    label: 'Obligation headroom',
    points: round(headroomValue * headroomMax),
    max: headroomMax,
    detail:
      features.avgMonthlyInflow > 0
        ? `${formatINR(features.fixedMonthlyOutflow)}/month already committed (${Math.round(
            commitmentRatio * 100,
          )}% of income) across ${features.detectedObligations.length} recurring obligations`
        : 'Cannot assess — no income signal to compare obligations against',
  });

  // 4. Spend consistency — erratic spending is a risk marker. Below three
  // months there is nothing to compare against, so this scores zero rather
  // than rewarding a user for having too little history to look volatile.
  const consistencyMax = 15;
  const assessable = features.monthsObserved >= 3;
  const consistencyValue = assessable ? clamp(1 - features.spendVolatility) : 0;
  breakdown.push({
    id: 'SPEND_CONSISTENCY',
    label: 'Spend consistency',
    points: round(consistencyValue * consistencyMax),
    max: consistencyMax,
    detail: assessable
      ? `Monthly spend averages ${formatINR(features.avgMonthlySpend)} with ${Math.round(
          features.spendVolatility * 100,
        )}% month-to-month variation`
      : `Only ${features.monthsObserved} month${
          features.monthsObserved === 1 ? '' : 's'
        } of history — not enough to assess consistency`,
  });

  // 5. Relationship depth — tenure and transaction count.
  const depthMax = 15;
  const tenureValue = clamp(features.accountAgeDays / 365);
  const activityValue = clamp(features.txnCount / 120);
  const relationshipValue = 0.6 * tenureValue + 0.4 * activityValue;
  breakdown.push({
    id: 'RELATIONSHIP_DEPTH',
    label: 'Relationship depth',
    points: round(relationshipValue * depthMax),
    max: depthMax,
    detail: `${features.accountAgeDays} days of history, ${features.txnCount} transactions observed`,
  });

  const score = Math.round(breakdown.reduce((total, component) => total + component.points, 0));
  return { score, breakdown };
}
