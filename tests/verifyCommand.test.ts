import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { data } from "../src/commands/verify";

type JsonOption = {
  name: string;
  type: number;
  required?: boolean;
  options?: JsonOption[];
};

describe("verify command schema", () => {
  it("lists required options before optional ones in every subcommand", () => {
    const json = data.toJSON() as { options?: JsonOption[] };

    for (const sub of json.options ?? []) {
      if (sub.type !== 1) continue; // SUB_COMMAND
      let seenOptional = false;

      for (const opt of sub.options ?? []) {
        if (opt.required) {
          assert.equal(
            seenOptional,
            false,
            `/${data.name} ${sub.name}: required option "${opt.name}" follows an optional option (Discord rejects this)`,
          );
        } else {
          seenOptional = true;
        }
      }
    }
  });
});
