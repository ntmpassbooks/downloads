import {
  BankAdapterFactory,
  PaymentProviderAdapter,
  SupportedBank,
} from './bank.adapters.js';

export type IPaymentProvider = PaymentProviderAdapter;

/**
 * Payment Provider Service
 * Provider-agnostic gateway routing requests to the appropriate Bank Adapter.
 */
export class PaymentProviderService {
  private static defaultAdapter: PaymentProviderAdapter | null = null;

  public static getProvider(bankCode?: string): PaymentProviderAdapter {
    if (this.defaultAdapter) {
      return this.defaultAdapter;
    }
    const bank = (bankCode || 'SBI') as SupportedBank;
    return BankAdapterFactory.getAdapter(bank);
  }

  public static setProvider(provider: PaymentProviderAdapter | null): void {
    this.defaultAdapter = provider;
  }
}
