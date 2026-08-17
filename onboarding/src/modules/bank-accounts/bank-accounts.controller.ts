import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../../common/audit/audit.service';
import { CurrentAuth } from '../../common/auth/auth-context.decorator';
import { AuthContext } from '../../common/auth/auth.types';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { presentBankAccount } from '../merchants/merchant.presenter';
import { BankAccountsService } from './bank-accounts.service';
import { ConfirmMicroDepositsDto } from './dto/confirm-micro-deposits.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';

@ApiTags('bank-accounts')
@Controller('merchants/:merchant_id/bank-accounts')
export class BankAccountsController {
  constructor(
    private readonly bankAccounts: BankAccountsService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Add a settlement bank account' })
  async add(
    @CurrentAuth() auth: AuthContext,
    @Param('merchant_id') merchantId: string,
    @Body() dto: CreateBankAccountDto,
  ) {
    const { merchant, account } = await this.bankAccounts.add(auth, merchantId, dto);
    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'bank_account.added',
      resourceType: 'bank_account',
      resourceId: account.publicId,
      changes: { last4: account.accountNumberLast4, currency: account.currency },
    });
    return presentBankAccount(account);
  }

  @Get()
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'List settlement bank accounts' })
  async list(@CurrentAuth() auth: AuthContext, @Param('merchant_id') merchantId: string) {
    const accounts = await this.bankAccounts.list(auth, merchantId);
    return { data: accounts.map(presentBankAccount) };
  }

  @Post(':bank_account_id/confirm-micro-deposits')
  @HttpCode(200)
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Confirm micro-deposit amounts to verify an account' })
  async confirm(
    @CurrentAuth() auth: AuthContext,
    @Param('merchant_id') merchantId: string,
    @Param('bank_account_id') bankAccountId: string,
    @Body() dto: ConfirmMicroDepositsDto,
  ) {
    const { merchant, account, verified } = await this.bankAccounts.confirmMicroDeposits(
      auth,
      merchantId,
      bankAccountId,
      dto,
    );
    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'bank_account.micro_deposits_confirmed',
      resourceType: 'bank_account',
      resourceId: account.publicId,
      changes: { verified },
    });
    return presentBankAccount(account);
  }
}
