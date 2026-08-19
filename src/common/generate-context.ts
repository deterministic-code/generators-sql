import { memoryReader } from "@deterministic-code/generators-common/deterministic-reader";
import type { GenerateContext } from "@deterministic-code/generators-common/generate-context";

export type { GenerateContext } from "@deterministic-code/generators-common/generate-context";

/** Host `{ inputs, settings }` shape used by dynamic generation. */
export type DeterministicInputs = {
  all: () => Promise<{
    datasourceYamlText?: string;
    datasourceSeedsYamlText?: string | null;
  }>;
  dir?: string;
};

export type GenerateArg =
  | GenerateContext
  | { inputs: DeterministicInputs; settings: Record<string, string> };

/** Pack-owned reader from `GenerateContext` or from `inputs.all()`. */
export const contextFrom = async (arg: GenerateArg): Promise<GenerateContext> => {
  if ("reader" in arg) return arg;
  const { datasourceYamlText, datasourceSeedsYamlText } = await arg.inputs.all();
  const files: Record<string, string> = {};
  if (datasourceYamlText !== undefined) {
    files["datasource_types.yaml"] = datasourceYamlText;
  }
  if (datasourceSeedsYamlText) {
    files["datasource_seeds.yaml"] = datasourceSeedsYamlText;
  }
  const settings = { ...arg.settings };
  if (arg.inputs.dir !== undefined) {
    settings["paths.deterministic"] = arg.inputs.dir;
  }
  return { reader: memoryReader(files), settings };
};
