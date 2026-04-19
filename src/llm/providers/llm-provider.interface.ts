export interface LlmProvider {
  generatePlan(userPrompt: string): Promise<unknown>;
}
