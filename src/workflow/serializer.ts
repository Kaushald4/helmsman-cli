import YAML from "yaml";
import { workflowAstSchema, type WorkflowAst } from "./ast.js";

/**
 * Serializes a WorkflowAst in-memory structure into clean YAML.
 */
export function serializeWorkflow(ast: WorkflowAst): string {
  const validated = workflowAstSchema.parse(ast);
  return YAML.stringify(validated, { indent: 2 });
}

/**
 * Parses and validates raw YAML text into a typed WorkflowAst.
 */
export function parseWorkflow(yamlText: string): WorkflowAst {
  const raw = YAML.parse(yamlText);
  return workflowAstSchema.parse(raw);
}
