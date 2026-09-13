# Fintech Onboarding API

A comprehensive, best-in-class merchant onboarding API platform that unifies patterns from multiple payment processor APIs (Worldpay PayFac, Payrix, Launchpad, Global Payments) into a single, cohesive solution optimized for global SMB/micro-merchants.

## Features

- **Merchant Onboarding**: Simple, fast merchant application process
- **KYB/KYC Verification**: Business and identity verification services
- **Risk Assessment**: Comprehensive fraud detection and risk scoring
- **Automated Underwriting**: Intelligent decision-making engine
- **Bank Account Management**: Secure bank account setup and verification
- **Webhook System**: Real-time event notifications
- **Multi-Region Compliance**: PCI DSS, GDPR, and regional regulation support
- **API Documentation**: Interactive Swagger/OpenAPI documentation

## Tech Stack

- **Framework**: NestJS (Node.js/TypeScript)
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT + API Keys (Passport.js)
- **Validation**: class-validator and class-transformer
- **API Documentation**: Swagger/OpenAPI
- **Testing**: Jest + Supertest
- **Rate Limiting**: @nestjs/throttler

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL (v14 or higher)
- npm or yarn

## Installation

1. Clone the repository and navigate to the project directory:
```bash
cd Projects/fintech-onboarding-api
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
NODE_ENV=development
PORT=3000
DATABASE_URL="postgresql://postgres:password@localhost:5432/fintech_onboarding?schema=public"
JWT_SECRET=your-super-secret-jwt-key-change-in-production
API_KEY_SALT=your-api-key-salt-change-in-production
ENCRYPTION_KEY=your-32-character-encryption-key
```

4. Generate Prisma Client:
```bash
npm run prisma:generate
```

5. Run database migrations:
```bash
npm run prisma:migrate
```

6. Seed the database (optional):
```bash
npm run prisma:seed
```

## Running the Application

### Development Mode
```bash
npm run start:dev
```

### Production Mode
```bash
npm run build
npm run start:prod
```

The API will be available at `http://localhost:3000`
API Documentation: `http://localhost:3000/api/docs`

## API Endpoints

### Merchants
- `POST /merchants` - Create new merchant application
- `GET /merchants/:merchantId` - Get merchant profile
- `POST /merchants/:merchantId/business-verification` - Submit business verification
- `POST /merchants/:merchantId/bank-accounts` - Add bank account
- `GET /merchants/:merchantId/status` - Get onboarding status

### Verification
- `POST /verify/business` - Trigger business verification
- `POST /verify/identity` - Trigger identity verification
- `POST /verify/bank-account` - Initiate bank account verification

### Risk Assessment
- `POST /risk/assess` - Trigger comprehensive risk assessment

### Underwriting
- `POST /underwriting/submit` - Submit for underwriting decision

### Webhooks
- `POST /webhooks` - Register webhook endpoint
- `GET /webhooks` - Get all webhooks for partner
- `DELETE /webhooks/:webhookId` - Delete webhook

### Authentication
- `POST /auth/login` - Login with email and password

## Authentication

The API supports two authentication methods:

1. **API Key**: Include `X-API-Key` header with your API key
2. **JWT Bearer Token**: Include `Authorization: Bearer <token>` header

## Example Usage

### Create a Merchant
```bash
curl -X POST http://localhost:3000/merchants \
  -H "Content-Type: application/json" \
  -H "X-API-Key: pk_test_1234567890abcdef" \
  -H "X-Partner-ID: test-partner-id" \
  -d '{
    "business_type": "company",
    "country": "US",
    "email": "merchant@example.com",
    "phone": "+1234567890",
    "business_name": "Acme Corp",
    "website": "https://acme.com",
    "mcc": "5734",
    "estimated_monthly_volume": 50000,
    "products_sold": ["electronics", "software"]
  }'
```

### Submit Business Verification
```bash
curl -X POST http://localhost:3000/merchants/{merchantId}/business-verification \
  -H "Content-Type: application/json" \
  -H "X-API-Key: pk_test_1234567890abcdef" \
  -H "X-Partner-ID: test-partner-id" \
  -d '{
    "legal_name": "Acme Corporation",
    "dba_name": "Acme Store",
    "tax_id": "12-3456789",
    "incorporation_date": "2015-06-15",
    "incorporation_country": "US",
    "incorporation_state": "DE",
    "business_address": {
      "line1": "123 Main St",
      "city": "San Francisco",
      "state": "CA",
      "postal_code": "94105",
      "country": "US"
    }
  }'
```

### Risk Assessment
```bash
curl -X POST http://localhost:3000/risk/assess \
  -H "Content-Type: application/json" \
  -H "X-API-Key: pk_test_1234567890abcdef" \
  -d '{
    "merchant_id": "mer_abc123",
    "assessment_type": "onboarding",
    "factors": ["industry_risk", "geographic_risk", "volume_risk", "identity_risk"]
  }'
```

## Testing

Run the test suite:
```bash
npm test
```

Run tests with coverage:
```bash
npm run test:cov
```

## Database Management

### Generate Prisma Client
```bash
npm run prisma:generate
```

### Run Migrations
```bash
npm run prisma:migrate
```

### Open Prisma Studio
```bash
npm run prisma:studio
```

### Seed Database
```bash
npm run prisma:seed
```

## Project Structure

```
src/
├── common/                 # Shared utilities
│   ├── dto/               # Data transfer objects
│   ├── guards/            # Auth guards
│   ├── interceptors/      # Request/response interceptors
│   ├── filters/           # Exception filters
│   └── decorators/        # Custom decorators
├── config/                # Configuration files
├── database/              # Database service
├── modules/               # Feature modules
│   ├── auth/             # Authentication module
│   ├── merchants/        # Merchant management
│   ├── verification/     # KYB/KYC verification
│   ├── risk/             # Risk assessment
│   ├── underwriting/     # Underwriting engine
│   └── webhooks/         # Webhook management
├── app.module.ts          # Root module
└── main.ts                # Application entry point
```

## Security Features

- **Rate Limiting**: 1000 requests per minute per API key
- **API Key Authentication**: Secure API key validation
- **JWT Authentication**: Token-based authentication
- **Input Validation**: Comprehensive request validation
- **Error Handling**: Structured error responses
- **Audit Logging**: Complete audit trail for compliance
- **CORS**: Configurable CORS policies
- **Data Protection**: Sensitive data handling

## Compliance

The platform is designed to support:
- **PCI DSS Level 1**: Payment card industry compliance
- **GDPR**: General Data Protection Regulation
- **Regional Compliance**: US (BSA/AML), UK (FCA/PSD2), EU (PSD2/AMLD5), Canada (FINTRAC)

## Development

### Code Style
The project follows NestJS best practices and TypeScript conventions.

### Adding New Features
1. Create a new module in `src/modules/`
2. Define DTOs in `src/common/dto/`
3. Implement service logic
4. Create controller with API endpoints
5. Add Swagger documentation
6. Write tests

## Performance

- **API Response Time**: <200ms for read operations, <500ms for write operations
- **Verification Time**: <5 minutes for automated verification
- **Underwriting Time**: <30 minutes for automated decisions
- **Uptime Target**: 99.9% SLA

## Monitoring & Logging

- **Request Logging**: All API requests are logged
- **Audit Trail**: Complete audit log for compliance
- **Error Tracking**: Structured error handling and logging
- **Performance Metrics**: Response time tracking

## Deployment

The application is designed for deployment on Google Cloud Platform (GCP):
- **Compute**: Cloud Run or GKE
- **Database**: Cloud SQL for PostgreSQL
- **Storage**: Cloud Storage for documents
- **Monitoring**: Cloud Monitoring and Logging
- **Secrets**: Secret Manager

## License

ISC

## Support

For issues and questions, please refer to the API documentation at `/api/docs` or contact the development team.