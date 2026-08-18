import { BankAccountFormat } from '../compliance/regions';

export interface BankAccountValidationResult {
  valid: boolean;
  format: BankAccountFormat;
  reason?: string;
}

/** ABA routing numbers carry a weighted mod-10 check digit. */
export function isValidAbaRoutingNumber(routingNumber: string): boolean {
  if (!/^\d{9}$/.test(routingNumber)) return false;
  const digits = routingNumber.split('').map(Number);
  const checksum =
    3 * (digits[0] + digits[3] + digits[6]) +
    7 * (digits[1] + digits[4] + digits[7]) +
    1 * (digits[2] + digits[5] + digits[8]);
  return checksum % 10 === 0;
}

/** IBAN validation via the ISO 13616 mod-97 rule. */
export function isValidIban(iban: string): boolean {
  const normalised = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(normalised)) return false;

  const rearranged = `${normalised.slice(4)}${normalised.slice(0, 4)}`;
  const numeric = rearranged.replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));

  let remainder = 0;
  for (const char of numeric) {
    remainder = (remainder * 10 + Number(char)) % 97;
  }
  return remainder === 1;
}

export function validateBankAccount(
  format: BankAccountFormat,
  routingNumber: string,
  accountNumber: string,
): BankAccountValidationResult {
  const routing = routingNumber.replace(/[\s-]/g, '');
  const account = accountNumber.replace(/[\s-]/g, '');

  switch (format) {
    case 'us_aba':
      if (!isValidAbaRoutingNumber(routing)) {
        return { valid: false, format, reason: 'routing_number_failed_checksum' };
      }
      if (!/^\d{4,17}$/.test(account)) {
        return { valid: false, format, reason: 'account_number_invalid_length' };
      }
      return { valid: true, format };

    case 'uk_sort_code':
      if (!/^\d{6}$/.test(routing)) {
        return { valid: false, format, reason: 'sort_code_must_be_6_digits' };
      }
      if (!/^\d{8}$/.test(account)) {
        return { valid: false, format, reason: 'account_number_must_be_8_digits' };
      }
      return { valid: true, format };

    case 'ca_transit':
      // Canadian routing is a 5-digit transit plus a 3-digit institution number.
      if (!/^\d{8}$/.test(routing)) {
        return { valid: false, format, reason: 'transit_and_institution_must_be_8_digits' };
      }
      if (!/^\d{7,12}$/.test(account)) {
        return { valid: false, format, reason: 'account_number_invalid_length' };
      }
      return { valid: true, format };

    case 'au_bsb':
      if (!/^\d{6}$/.test(routing)) {
        return { valid: false, format, reason: 'bsb_must_be_6_digits' };
      }
      if (!/^\d{5,10}$/.test(account)) {
        return { valid: false, format, reason: 'account_number_invalid_length' };
      }
      return { valid: true, format };

    case 'iban':
      if (!isValidIban(account)) {
        return { valid: false, format, reason: 'iban_failed_mod97_check' };
      }
      return { valid: true, format };
  }
}
