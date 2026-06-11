import { describe } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import {
  AstNode,
  CallExpression,
  Identifier,
  MemberExpression,
  ObjectExpression,
  StringLiteral,
  UnknownNode,
} from '../ast-node.schema.js'

describe('AST node schema laws', () => {
  ruleOfSchemas('Identifier', Identifier)
  ruleOfSchemas('StringLiteral', StringLiteral)
  ruleOfSchemas('ObjectExpression', ObjectExpression)
  ruleOfSchemas('MemberExpression', MemberExpression)
  ruleOfSchemas('CallExpression', CallExpression)
  ruleOfSchemas('UnknownNode', UnknownNode)
  ruleOfSchemas('AstNode', AstNode)
})
