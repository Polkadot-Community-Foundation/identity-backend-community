import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import {
  DIMLiteral,
  DimTicketRecord,
  EncodableDimTicketStatus,
  InviteeAddress,
  InviterAddress,
  NetworkLiteral,
  SubmittingTicket,
} from '../dim-ticket.types.js'

describe('Rule of Schemas', () => {
  ruleOfSchemas('InviterAddress', InviterAddress)
  ruleOfSchemas('InviteeAddress', InviteeAddress)
  ruleOfSchemas('DIMLiteral', DIMLiteral)
  ruleOfSchemas('NetworkLiteral', NetworkLiteral)
  ruleOfSchemas('DimTicketRecord', DimTicketRecord)
  ruleOfSchemas('EncodableDimTicketStatus', EncodableDimTicketStatus)
  ruleOfSchemas('SubmittingTicket', SubmittingTicket)
})
