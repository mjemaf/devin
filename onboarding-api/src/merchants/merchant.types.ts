export interface AddressJson {
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postal_code: string;
  country: string;
}

export interface BusinessProfileJson {
  legal_name?: string | null;
  dba_name?: string | null;
  business_name: string;
  tax_id_last4?: string | null;
  tax_id_token?: string | null;
  registration_number?: string | null;
  incorporation_date?: string | null;
  incorporation_country?: string | null;
  incorporation_state?: string | null;
  mcc: string;
  website?: string | null;
  estimated_monthly_volume: number;
  products_sold: string[];
}

export interface ContactJson {
  email: string;
  phone: string;
}

export interface ProcessingLimitsJson {
  daily_limit: number;
  monthly_limit: number;
  ticket_size_limit: number;
  currency: string;
}
