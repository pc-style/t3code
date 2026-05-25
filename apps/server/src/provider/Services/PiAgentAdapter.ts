/**
 * PiAgentAdapter — shape type for the Pi Agent provider adapter.
 *
 * @module PiAgentAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface PiAgentAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
