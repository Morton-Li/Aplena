import { invoke } from "@tauri-apps/api/core";

export interface EnumOption {
  code: string;
  label: string;
}
export interface DomainContract {
  categories: EnumOption[];
  flow_types: EnumOption[];
  recognition_modes: EnumOption[];
  amount_decimal_places: number;
  exchange_rate_decimal_places: number;
}

export interface AppError {
  error_code: string;
  field?: string;
  message_key: string;
}

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function getDomainContract(invokeCommand: Invoke = invoke): Promise<DomainContract> {
  return invokeCommand<DomainContract>("get_domain_contract");
}
