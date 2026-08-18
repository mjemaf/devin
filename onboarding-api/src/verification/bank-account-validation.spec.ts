import { isValidAbaRoutingNumber, isValidIban, validateBankAccount } from './bank-account-validation';

describe('isValidAbaRoutingNumber', () => {
  it('accepts routing numbers that satisfy the mod-10 checksum', () => {
    expect(isValidAbaRoutingNumber('021000021')).toBe(true);
    expect(isValidAbaRoutingNumber('011401533')).toBe(true);
  });

  it('rejects wrong lengths, non-digits and bad check digits', () => {
    expect(isValidAbaRoutingNumber('02100002')).toBe(false);
    expect(isValidAbaRoutingNumber('02100002X')).toBe(false);
    expect(isValidAbaRoutingNumber('021000022')).toBe(false);
  });
});

describe('isValidIban', () => {
  it('accepts well-formed IBANs, ignoring spacing and case', () => {
    expect(isValidIban('DE89370400440532013000')).toBe(true);
    expect(isValidIban('de89 3704 0044 0532 0130 00')).toBe(true);
  });

  it('rejects IBANs that fail the mod-97 check', () => {
    expect(isValidIban('DE89370400440532013001')).toBe(false);
    expect(isValidIban('NOTANIBAN')).toBe(false);
  });
});

describe('validateBankAccount', () => {
  it('validates US accounts against the routing checksum and account length', () => {
    expect(validateBankAccount('us_aba', '021000021', '000123456789')).toEqual({
      valid: true,
      format: 'us_aba',
    });
    expect(validateBankAccount('us_aba', '021000022', '000123456789').reason).toBe(
      'routing_number_failed_checksum',
    );
    expect(validateBankAccount('us_aba', '021000021', '12').reason).toBe(
      'account_number_invalid_length',
    );
  });

  it('validates UK sort codes and 8-digit account numbers', () => {
    expect(validateBankAccount('uk_sort_code', '40-47-84', '12345678').valid).toBe(true);
    expect(validateBankAccount('uk_sort_code', '4047', '12345678').reason).toBe(
      'sort_code_must_be_6_digits',
    );
    expect(validateBankAccount('uk_sort_code', '404784', '1234567').reason).toBe(
      'account_number_must_be_8_digits',
    );
  });

  it('validates Canadian transit numbers and Australian BSBs', () => {
    expect(validateBankAccount('ca_transit', '00012345', '1234567').valid).toBe(true);
    expect(validateBankAccount('ca_transit', '12345', '1234567').reason).toBe(
      'transit_and_institution_must_be_8_digits',
    );
    expect(validateBankAccount('au_bsb', '082-039', '123456').valid).toBe(true);
    expect(validateBankAccount('au_bsb', '82039', '123456').reason).toBe('bsb_must_be_6_digits');
  });

  it('validates IBAN countries from the account number alone', () => {
    expect(validateBankAccount('iban', '', 'DE89 3704 0044 0532 0130 00').valid).toBe(true);
    expect(validateBankAccount('iban', '', 'DE89370400440532013001').reason).toBe(
      'iban_failed_mod97_check',
    );
  });
});
