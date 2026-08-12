import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Android privacy screen contract", () => {
  const activity = readFileSync(
    resolve("android/app/src/main/java/com/praeventio/guard/MainActivity.java"),
    "utf8",
  );

  it("applies FLAG_SECURE before the Activity can display PII", () => {
    const onCreate = activity.indexOf(
      "public void onCreate(Bundle savedInstanceState)",
    );
    const superOnCreate = activity.indexOf(
      "super.onCreate(savedInstanceState)",
      onCreate,
    );
    const secureFlag = activity.indexOf(
      "WindowManager.LayoutParams.FLAG_SECURE",
      onCreate,
    );

    expect(onCreate).toBeGreaterThanOrEqual(0);
    expect(secureFlag).toBeGreaterThan(onCreate);
    expect(secureFlag).toBeLessThan(superOnCreate);
  });
});
