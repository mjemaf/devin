import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service';
import { Principal } from '../../common/auth/principal';
import { RequestContext } from '../../common/context/request-context';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { encryptValue } from '../../common/util/crypto';
import { newReference } from '../../common/util/references';
import { ComplianceService } from '../compliance/compliance.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { MerchantStateService } from './merchant-state.service';
import { serializeBankAccount } from './merchant.serializer';

/** Length of the country-specific bank identifier, used as a cheap format check. */
const IDENTIFIER_LENGTHS: Record<string, number> = {
  routing_number: 9,
  sort_code: 6,
  transit_number: 5,
  bsb: 6,
};

@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MerchantStateService,
    private readonly compliance: ComplianceService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async add(
    principal: Principal,
    reference: string,
    dto: CreateBankAccountDto,
    context: RequestContext,
  ) {
    const merchant = await this.state.require(principal, reference);
    const rules = this.compliance.rulesFor(dto.country ?? merchant.country);
    this.assertIdentifierFormat(rules.bankIdentifierLabel, dto.routing_number);

    const accountNumber = dto.account_number.replace(/\s/g, '');
    const isFirst = (await this.prisma.bankAccount.count({ where: { merchantId: merchant.id } })) === 0;

    const account = await this.prisma.bankAccount.create({
      data: {
        reference: newReference('bankAccount'),
        merchantId: merchant.id,
        accountNumberLast4: accountNumber.slice(-4),
        accountNumberToken: encryptValue(
          this.config.getOrThrow<string>('dataEncryptionKey'),
          accountNumber,
        ),
        routingNumber: dto.routing_number,
        accountType: dto.account_type,
        currency: dto.currency,
        country: (dto.country ?? merchant.country).toUpperCase(),
        accountHolderName: dto.account_holder_name,
        verificationMethod: dto.verification_method ?? 'instant',
        isDefault: dto.is_default ?? isFirst,
      },
    });

    if (account.isDefault) {
      await this.prisma.bankAccount.updateMany({
        where: { merchantId: merchant.id, id: { not: account.id } },
        data: { isDefault: false },
      });
    }

    const updated = await this.state.setStepStatus(merchant.id, 'bank_account_setup', 'in_progress', [
      `verify_bank_account:${account.reference}`,
    ]);

    await this.audit.record(
      principal,
      {
        action: 'merchant.bank_account_added',
        resourceType: 'bank_account',
        resourceId: account.reference,
        merchantId: merchant.id,
        changes: {
          account_number_last4: account.accountNumberLast4,
          currency: account.currency,
        },
      },
      context,
    );

    return {
      ...serializeBankAccount(account),
      bank_identifier_label: rules.bankIdentifierLabel,
      next_actions: ['POST /v1/verify/bank-account'],
      onboarding: this.state.state(updated),
    };
  }

  async list(principal: Principal, reference: string) {
    const merchant = await this.state.require(principal, reference);
    const accounts = await this.prisma.bankAccount.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'asc' },
    });
    return { data: accounts.map(serializeBankAccount) };
  }

  private assertIdentifierFormat(label: string, value: string): void {
    if (label === 'iban') {
      if (!/^[A-Z]{2}[0-9A-Z]{13,32}$/.test(value.replace(/\s/g, '').toUpperCase())) {
        throw ApiException.validation(
          'invalid_bank_identifier',
          'routing_number must be a valid IBAN for this country.',
          'routing_number',
        );
      }
      return;
    }

    const digits = value.replace(/\D/g, '');
    const expected = IDENTIFIER_LENGTHS[label];
    if (expected && digits.length !== expected) {
      throw ApiException.validation(
        'invalid_bank_identifier',
        `routing_number must be a ${expected} digit ${label} for this country.`,
        'routing_number',
      );
    }
  }
}
