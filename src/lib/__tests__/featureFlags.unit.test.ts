import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  let currentKey = "";

  const setValues = (entries: Record<string, unknown>) => {
    values.clear();
    Object.entries(entries).forEach(([key, value]) => values.set(key, value));
  };

  const mockMaybeSingle = vi.fn(async () => {
    if (!values.has(currentKey)) {
      return { data: null, error: null };
    }

    return { data: { value: values.get(currentKey) }, error: null };
  });

  const queryBuilder: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: mockMaybeSingle,
  };

  queryBuilder.select.mockReturnValue(queryBuilder);
  queryBuilder.eq.mockImplementation((column: string, value: string) => {
    if (column === "key") {
      currentKey = value;
    }
    return queryBuilder;
  });

  const mockFrom = vi.fn(() => queryBuilder);

  return {
    mockFrom,
    mockMaybeSingle,
    setValues,
  };
});

vi.mock("../supabase", () => ({
  supabase: {
    from: mocks.mockFrom,
  },
}));

import { invalidateFeatureFlagCache, isConflictV2Enabled } from "../featureFlags";

describe("featureFlags app_config compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateFeatureFlagCache();
    mocks.setValues({});
  });

  it("accepts legacy conflict_v2_canary_users allow-list key", async () => {
    mocks.setValues({
      conflict_v2_canary_users: '["user-123"]',
    });

    await expect(isConflictV2Enabled("user-123")).resolves.toBe(true);
  });

  it("parses TEXT rollout percent values", async () => {
    mocks.setValues({
      conflict_v2_rollout_pct: "100",
    });

    await expect(isConflictV2Enabled("any-user")).resolves.toBe(true);
  });

  it("parses comma-separated TEXT lists for allow/block keys", async () => {
    mocks.setValues({
      conflict_v2_users: "alice, bob",
      conflict_v2_blocklist: "mallory, eve",
      conflict_v2_rollout_pct: "0",
      conflict_v2_enabled: "false",
    });

    await expect(isConflictV2Enabled("bob")).resolves.toBe(true);
    await expect(isConflictV2Enabled("eve")).resolves.toBe(false);
  });

  it("parses TEXT boolean fallback for global enablement", async () => {
    mocks.setValues({
      conflict_v2_enabled: "true",
    });

    await expect(isConflictV2Enabled("random-user")).resolves.toBe(true);
  });
});
