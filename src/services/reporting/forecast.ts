/**
 * This service contains the calculations for the "actions" in a report
 * That means the user can add actions to the report that will reduce the emissions
 * Also he can add targets for the emissions
 * The service will calculate the emissions for the report
 */

import { ActionEntry, TargetEntry } from '../types';

// interface Target {
//     year: number;
//     percentage: number;
// }

// interface Action {
//     finishedUntil: string; // Format: YYYY-MM-DD
//     targetInTons: number;
//     relevant: boolean;
// }

export interface OldReportValues {
  year: number;
  value: number;
}

export interface EmissionValue {
  realReportValue: null | number; // real value for this time period. null if no value exists
  refValue: number; // reference value for this time period
  targetValue: number; // target value for the month. theoretically
  realValueWithActions: number; // real possible value for the month if all actions are done
  savedAbsolut: number; // saved absolut value in this year
  percentageToRef: number; // in this year active target percentage
  date: string; // Format: YYYY-MM-DD
  realValueWithActionsInterpolated?: null | number; // is null and only set in years with new finished actions
  targetValueInterpolated?: null | number; // is null and set only in years with new targets
}

export interface EmissionResult {
  monthlyResults: EmissionValue[];
  yearlyResults: EmissionValue[];
}

export function calculateEmissions(
  oldValues: OldReportValues[],
  targets: TargetEntry[],
  actions: ActionEntry[],
  referenceYear: number,
): EmissionResult {
  if (oldValues.length === 0) {
    throw new Error('No old values given');
  }

  // sort old values from old to new
  oldValues.sort((a, b) => a.year - b.year);

  // sort targets from old to new
  targets.sort((a, b) => a.year - b.year);

  // create a map of the old values
  const emissions = new Map<number, number>();
  oldValues.forEach((val) => emissions.set(val.year, val.value));

  // get the reference value
  const referenceValue = emissions.get(referenceYear);
  if (!referenceValue) {
    throw new Error(`No reference value for year ${referenceYear}`);
  }

  // last year from old values
  const startYear = oldValues[0].year;
  // last year from targets
  const endYear = targets[targets.length - 1].year;

  // iterate from start to end and calculate the emissions per month
  const monthlyResults = [];
  const yearlyResults = [];

  // set the main target percentage here since this will effect all years after start year of the target
  let actualTargetPercentage = 0;
  let actualSustractionValue = 0;

  // calculate the fixes monthly value for the years without targets and actions
  const referenceValuePerMonth = referenceValue / 12;

  for (let year = startYear; year <= endYear; year++) {
    // check if a real value exists for the year. if not use the reference value
    const yearValue: number = emissions.get(year) ?? referenceValue;
    // console.log('Jahr: ' + year + ' Wert: ' + yearValue);

    // check if a target in [%] exists for the year. if not use 0[%]
    const target = targets.find((t) => t.year === year);
    // overwrite the target percentage if a target exists. if not use the old target percentage
    actualTargetPercentage = target
      ? target.percentage
      : actualTargetPercentage;

    // normal value for the month including calulations of targets
    const absoluteValueForYear = yearValue * (1 - actualTargetPercentage / 100);

    // normal monthly value for the month without actions and targets
    const absoluteValuePerMonth = absoluteValueForYear / 12;

    // iterate over the months of the year
    let amount = 0;
    for (let month = 1; month <= 12; month++) {
      // check if an action exists for the year and the actual pointer month. if not use 0.
      const actionsEffect = actions
        .filter((action) => {
          if (!action.finished_until_planned || !action.relevant) {
            return false;
          }
          const date = new Date(action.finished_until_planned);
          return date.getFullYear() === year && date.getMonth() === month - 1;
        })
        .reduce((acc, action) => acc + action.target_value_absolut_planned, 0);

      // add this value (part for one month) to the floating subtraction value
      actualSustractionValue += actionsEffect / 12;
      // debug
      // if (actionsEffect > 0) {
      //     console.log('Jahr: ' + year + ', Monat: ' + month + ' Ab jetzt spart eine Maßnahme: ' + actionsEffect);
      // }
      // console.log('Gesamteinsparung aktuell: ' + actualSustractionValue);

      // calculate the real value for the month minus the comulated actions
      const withActions = referenceValuePerMonth - actualSustractionValue;
      amount += withActions;

      monthlyResults.push({
        realReportValue:
          year === referenceYear && month === 1 ? referenceValue : null,
        date: new Date(year, month - 1).toISOString(),
        refValue: referenceValuePerMonth,
        targetValue: absoluteValuePerMonth,
        realValueWithActions: withActions,
        savedAbsolut: absoluteValuePerMonth - withActions,
        percentageToRef: actualTargetPercentage,
      });
    }

    // search again for all actions that are in this year
    const yearlyActionEffect = actions
      .filter((action) => {
        if (!action.finished_until_planned || !action.relevant) {
          return false;
        }
        const date = new Date(action.finished_until_planned);
        return date.getFullYear() === year;
      })
      .reduce((acc, action) => acc + action.target_value_absolut_planned, 0);

    // actionbases only will be only set if new actions are done in this year
    // but also the first and the last year are needed to draw the graph
    let realValueWithActionsInterpolated = null;
    if (yearlyActionEffect > 0 || year === endYear) {
      realValueWithActionsInterpolated = amount;
    } else if (year === startYear) {
      realValueWithActionsInterpolated = referenceValue;
    }
    let targetValueInterpolated = null;
    if (target) {
      targetValueInterpolated = referenceValue * (1 - target.percentage / 100);
    } else if (year === startYear) {
      targetValueInterpolated = referenceValue;
    }

    // add values for the year
    const yearResult: EmissionValue = {
      realReportValue: year === referenceYear ? referenceValue : null,
      date: new Date(year, 0).toISOString(),
      refValue: referenceValue,
      targetValue: referenceValue * (1 - actualTargetPercentage / 100),
      realValueWithActions: amount,
      percentageToRef: actualTargetPercentage,
      savedAbsolut: absoluteValueForYear - amount,
      realValueWithActionsInterpolated,
      targetValueInterpolated,
    };
    // console.log(yearResult);
    yearlyResults.push(yearResult);
  }

  return { yearlyResults, monthlyResults };
}

// accepts an array of numbers or null values and gets the average values instead of the null values
// Necessary for apexcharts to draw a line with interpolated values in a mixed chart
export function getAverageValues(
  arr: Array<number | null | undefined>,
): Array<any> {
  let result = [...arr];

  for (let i = 0; i < result.length; i++) {
    if (result[i] === null) {
      // Find the previous non-null value
      let startIndex = i - 1;
      while (startIndex >= 0 && result[startIndex] === null) {
        startIndex--;
      }
      const startValue = startIndex >= 0 ? result[startIndex] : null;

      // Find the next non-null value
      let endIndex = i + 1;
      while (endIndex < result.length && result[endIndex] === null) {
        endIndex++;
      }
      const endValue = endIndex < result.length ? result[endIndex] : null;

      // If both startValue and endValue are non-null, interpolate
      if (startValue && endValue) {
        const gap = endIndex - startIndex;
        const step = (endValue - startValue) / gap;
        for (let j = startIndex + 1; j < endIndex; j++) {
          result[j] = startValue + step * (j - startIndex);
        }
      } else {
        // If one of the ends is null, fill all values with the non-null end value
        // Or use 0 if both ends are null (though this case should ideally not happen in chart data)
        const fillValue =
          startValue !== null ? startValue : endValue !== null ? endValue : 0;
        for (let j = startIndex + 1; j <= endIndex - 1; j++) {
          result[j] = fillValue;
        }
      }
    }
  }

  return result;
}

// formats numbers to the german format (1.000,00), optional number of fractiondigits
export const numbersFormatter = (
  value: number,
  maximumFractionDigits: number = 2,
) => {
  const formatter = new Intl.NumberFormat('de-DE', {
    maximumFractionDigits,
  });
  return formatter.format(value);
};
