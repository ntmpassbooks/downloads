export type InterestType = 'FLAT' | 'REDUCING_BALANCE';
export type RatePeriod = 'MONTHLY' | 'ANNUAL';

export interface LoanCalculationInput {
  principal: number;
  interestRate: number;
  interestType: InterestType;
  ratePeriod: RatePeriod;
  tenureMonths: number;
  firstDueDate?: string; // YYYY-MM-DD
}

export interface CalculatedInstallment {
  installmentNumber: number;
  dueDate: string; // YYYY-MM-DD
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  remainingPrincipal: number;
}

export interface LoanCalculationResult {
  principal: number;
  interestRate: number;
  interestType: InterestType;
  ratePeriod: RatePeriod;
  tenureMonths: number;
  monthlyInstallment: number;
  totalInterest: number;
  totalPayable: number;
  firstDueDate: string;
  installments: CalculatedInstallment[];
}

/**
 * Pure calculation module for Flat and Reducing-Balance EMI loan schedules.
 * Guarantees zero floating-point penny discrepancies through exact integer rounding
 * and final installment balancing.
 */
export class LoanCalculator {
  /**
   * Helper to add months to a given date while clamping to valid month days.
   */
  public static addMonthsToDate(baseDateStr: string, monthsToAdd: number): string {
    const [yearStr, monthStr, dayStr] = baseDateStr.slice(0, 10).split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1; // 0-indexed
    const day = parseInt(dayStr, 10);

    const targetDate = new Date(year, month + monthsToAdd, 1);
    const targetYear = targetDate.getFullYear();
    const targetMonth = targetDate.getMonth();

    // Days in target month
    const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const clampedDay = Math.min(day, daysInTargetMonth);

    const y = String(targetYear).padStart(4, '0');
    const m = String(targetMonth + 1).padStart(2, '0');
    const d = String(clampedDay).padStart(2, '0');

    return `${y}-${m}-${d}`;
  }

  /**
   * Computes the complete loan schedule with installments.
   */
  public static calculateSchedule(input: LoanCalculationInput): LoanCalculationResult {
    const {
      principal,
      interestRate,
      interestType,
      ratePeriod,
      tenureMonths,
    } = input;

    if (principal <= 0) {
      throw new Error('मुद्दल रक्कम ० पेक्षा जास्त असावी (Principal must be greater than 0)');
    }
    if (tenureMonths <= 0) {
      throw new Error('कर्ज कालावधी किमान १ महिना असावा (Tenure must be at least 1 month)');
    }
    if (interestRate < 0) {
      throw new Error('व्याज दर ० किंवा अधिक असावा (Interest rate cannot be negative)');
    }

    // Default first due date: 1 month from today
    let firstDueDate = input.firstDueDate;
    if (!firstDueDate) {
      const today = new Date();
      firstDueDate = this.addMonthsToDate(today.toISOString().slice(0, 10), 1);
    }

    if (interestType === 'FLAT') {
      return this.calculateFlatSchedule({
        principal,
        interestRate,
        ratePeriod,
        tenureMonths,
        firstDueDate,
      });
    } else {
      return this.calculateReducingBalanceSchedule({
        principal,
        interestRate,
        ratePeriod,
        tenureMonths,
        firstDueDate,
      });
    }
  }

  /**
   * Flat Interest Formula:
   * Annual: totalInterest = Math.round(principal * (rate / 100) * (tenureMonths / 12))
   * Monthly: totalInterest = Math.round(principal * (rate / 100) * tenureMonths)
   */
  private static calculateFlatSchedule(params: {
    principal: number;
    interestRate: number;
    ratePeriod: RatePeriod;
    tenureMonths: number;
    firstDueDate: string;
  }): LoanCalculationResult {
    const { principal, interestRate, ratePeriod, tenureMonths, firstDueDate } = params;

    let totalInterest = 0;
    if (interestRate > 0) {
      if (ratePeriod === 'ANNUAL') {
        totalInterest = Math.round(principal * (interestRate / 100) * (tenureMonths / 12));
      } else {
        totalInterest = Math.round(principal * (interestRate / 100) * tenureMonths);
      }
    }

    const totalPayable = principal + totalInterest;
    const monthlyInstallment = Math.round(totalPayable / tenureMonths);

    const basePrincipalPerMonth = Math.floor(principal / tenureMonths);
    let principalRemainder = principal - (basePrincipalPerMonth * tenureMonths);

    const baseInterestPerMonth = Math.floor(totalInterest / tenureMonths);
    let interestRemainder = totalInterest - (baseInterestPerMonth * tenureMonths);

    const installments: CalculatedInstallment[] = [];
    let runningPrincipal = principal;

    for (let i = 1; i <= tenureMonths; i++) {
      const dueDate = this.addMonthsToDate(firstDueDate, i - 1);
      
      let pAmount = basePrincipalPerMonth;
      if (principalRemainder > 0) {
        pAmount += 1;
        principalRemainder -= 1;
      }

      let iAmount = baseInterestPerMonth;
      if (interestRemainder > 0) {
        iAmount += 1;
        interestRemainder -= 1;
      }

      runningPrincipal -= pAmount;

      installments.push({
        installmentNumber: i,
        dueDate,
        principalAmount: pAmount,
        interestAmount: iAmount,
        totalAmount: pAmount + iAmount,
        remainingPrincipal: Math.max(0, runningPrincipal),
      });
    }

    return {
      principal,
      interestRate,
      interestType: 'FLAT',
      ratePeriod,
      tenureMonths,
      monthlyInstallment,
      totalInterest,
      totalPayable,
      firstDueDate,
      installments,
    };
  }

  /**
   * Reducing-Balance EMI Formula:
   * r = monthly interest rate
   * EMI = [P * r * (1 + r)^n] / [(1 + r)^n - 1]
   */
  private static calculateReducingBalanceSchedule(params: {
    principal: number;
    interestRate: number;
    ratePeriod: RatePeriod;
    tenureMonths: number;
    firstDueDate: string;
  }): LoanCalculationResult {
    const { principal, interestRate, ratePeriod, tenureMonths, firstDueDate } = params;

    if (interestRate === 0) {
      return this.calculateFlatSchedule({
        principal,
        interestRate: 0,
        ratePeriod,
        tenureMonths,
        firstDueDate,
      });
    }

    const r = ratePeriod === 'ANNUAL' ? (interestRate / 100) / 12 : (interestRate / 100);
    const num = principal * r * Math.pow(1 + r, tenureMonths);
    const den = Math.pow(1 + r, tenureMonths) - 1;
    const emi = Math.round(num / den);

    const installments: CalculatedInstallment[] = [];
    let currentBalance = principal;
    let accumulatedInterest = 0;

    for (let i = 1; i <= tenureMonths; i++) {
      const dueDate = this.addMonthsToDate(firstDueDate, i - 1);
      const interestForMonth = Math.round(currentBalance * r);

      let principalForMonth: number;
      let totalAmount: number;

      if (i === tenureMonths) {
        // Final installment absorbs any small rounding difference to ensure balance hits exact 0
        principalForMonth = currentBalance;
        totalAmount = principalForMonth + interestForMonth;
      } else {
        principalForMonth = emi - interestForMonth;
        if (principalForMonth > currentBalance) {
          principalForMonth = currentBalance;
        }
        totalAmount = principalForMonth + interestForMonth;
      }

      currentBalance -= principalForMonth;
      accumulatedInterest += interestForMonth;

      installments.push({
        installmentNumber: i,
        dueDate,
        principalAmount: principalForMonth,
        interestAmount: interestForMonth,
        totalAmount,
        remainingPrincipal: Math.max(0, currentBalance),
      });
    }

    const totalPayable = principal + accumulatedInterest;

    return {
      principal,
      interestRate,
      interestType: 'REDUCING_BALANCE',
      ratePeriod,
      tenureMonths,
      monthlyInstallment: emi,
      totalInterest: accumulatedInterest,
      totalPayable,
      firstDueDate,
      installments,
    };
  }
}
