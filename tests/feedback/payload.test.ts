import { describe, expect, it } from "vitest";
import { INSTANCE } from "../../src/lib/brand/instance";
import {
  buildFeedbackPayload,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABEL,
  MAX_IMAGE_DATA_URL_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  type FeedbackPayloadInput,
} from "../../src/lib/feedback/payload";

const BASE: FeedbackPayloadInput = {
  kind: "bug",
  title: "the score looks wrong",
  text: "the score near the Aleutians looks too high",
  email: "",
  includeUrl: false,
  pageUrl: "https://marinesensitivity.org/atlas/?lens=scores&ver=v9",
  hash: "#pl=g1.test.SECRET",
  ver: "v9",
  access: "public",
  appVersion: "0.10.33",
  appSha: "abc1234",
  lens: "scores",
  viewport: "1280x800",
  theme: "navy",
  userAgent: "Mozilla/5.0 (test)",
  website: "",
};

describe("buildFeedbackPayload — the hash/URL privacy rule", () => {
  it("omits `url` entirely when includeUrl is false, even though pageUrl/hash are given", () => {
    const payload = buildFeedbackPayload({ ...BASE, includeUrl: false });
    expect("url" in payload).toBe(false);
    expect(payload.url).toBeUndefined();
  });

  it("includes `url` (pageUrl + hash) when includeUrl is true", () => {
    const payload = buildFeedbackPayload({ ...BASE, includeUrl: true });
    expect(payload.url).toBe(
      "https://marinesensitivity.org/atlas/?lens=scores&ver=v9#pl=g1.test.SECRET",
    );
  });

  it("never leaks the hash into any OTHER field when includeUrl is false", () => {
    const payload = buildFeedbackPayload({ ...BASE, includeUrl: false });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("#pl=");
    expect(serialized).not.toContain("SECRET");
  });

  it("carries the hash's content when includeUrl is true (it is the whole point of ticking the box)", () => {
    const payload = buildFeedbackPayload({ ...BASE, includeUrl: true });
    expect(JSON.stringify(payload)).toContain("SECRET");
  });

  it("an empty hash still produces a `url` field (just the page, no fragment) when ticked", () => {
    const payload = buildFeedbackPayload({ ...BASE, includeUrl: true, hash: "" });
    expect(payload.url).toBe("https://marinesensitivity.org/atlas/?lens=scores&ver=v9");
  });
});

describe("buildFeedbackPayload — restricted flag from release.access", () => {
  it('true only for the literal "restricted"', () => {
    expect(buildFeedbackPayload({ ...BASE, access: "restricted" }).restricted).toBe(true);
  });

  it('false for "public"', () => {
    expect(buildFeedbackPayload({ ...BASE, access: "public" }).restricted).toBe(false);
  });

  it('false for "unknown"', () => {
    expect(buildFeedbackPayload({ ...BASE, access: "unknown" }).restricted).toBe(false);
  });

  it("false when access is undefined (unresolved release)", () => {
    expect(buildFeedbackPayload({ ...BASE, access: undefined }).restricted).toBe(false);
  });

  it("false for a garbage/typo'd access value -- never fails OPEN toward hiding the GitHub issue", () => {
    expect(buildFeedbackPayload({ ...BASE, access: "Restricted" }).restricted).toBe(false);
  });
});

describe("buildFeedbackPayload — honeypot", () => {
  it("passes the honeypot value through untouched (empty from a real submitter)", () => {
    expect(buildFeedbackPayload({ ...BASE, website: "" }).website).toBe("");
  });

  it("still passes a NON-empty honeypot value through -- this pure function never rejects it; the server does", () => {
    expect(buildFeedbackPayload({ ...BASE, website: "http://spam.example" }).website).toBe(
      "http://spam.example",
    );
  });

  it('defaults to "" when website is omitted entirely', () => {
    expect(buildFeedbackPayload({ ...BASE, website: undefined }).website).toBe("");
  });
});

describe("buildFeedbackPayload — size caps", () => {
  it("keeps an image under the cap", () => {
    const image = `data:image/png;base64,${"A".repeat(100)}`;
    expect(buildFeedbackPayload({ ...BASE, image }).image).toBe(image);
  });

  it("drops an image over MAX_IMAGE_DATA_URL_LENGTH entirely (never truncates it into a broken data URL)", () => {
    const image = `data:image/png;base64,${"A".repeat(MAX_IMAGE_DATA_URL_LENGTH + 1)}`;
    const payload = buildFeedbackPayload({ ...BASE, image });
    expect(payload.image).toBeUndefined();
    expect("image" in payload).toBe(false);
  });

  it("omits `image` entirely when none is given", () => {
    expect("image" in buildFeedbackPayload(BASE)).toBe(false);
  });

  it("trims text to MAX_TEXT_LENGTH", () => {
    const text = "x".repeat(MAX_TEXT_LENGTH + 500);
    expect(buildFeedbackPayload({ ...BASE, text }).text.length).toBe(MAX_TEXT_LENGTH);
  });

  it("trims title to MAX_TITLE_LENGTH", () => {
    const title = "y".repeat(MAX_TITLE_LENGTH + 50);
    expect(buildFeedbackPayload({ ...BASE, title }).title.length).toBe(MAX_TITLE_LENGTH);
  });

  it("trims surrounding whitespace off title/text/email", () => {
    const payload = buildFeedbackPayload({
      ...BASE,
      title: "  hi  ",
      text: "  hello  ",
      email: "  me@example.org  ",
    });
    expect(payload.title).toBe("hi");
    expect(payload.text).toBe("hello");
    expect(payload.email).toBe("me@example.org");
  });
});

describe("buildFeedbackPayload — the fixed fields every payload carries", () => {
  it('app is always the instance\'s feedback key (the shared Apps Script APPS key: "oceanmetrics-atlas", or "atlas" for the MarineSensitivity Atlas)', () => {
    expect(buildFeedbackPayload(BASE).app).toBe(INSTANCE.feedback.app);
  });

  it("release/version/sha/lens/viewport/theme/user_agent map 1:1 from the input", () => {
    const payload = buildFeedbackPayload(BASE);
    expect(payload.release).toBe("v9");
    expect(payload.version).toBe("0.10.33");
    expect(payload.sha).toBe("abc1234");
    expect(payload.lens).toBe("scores");
    expect(payload.viewport).toBe("1280x800");
    expect(payload.theme).toBe("navy");
    expect(payload.user_agent).toBe("Mozilla/5.0 (test)");
  });

  it("release is an empty string, never null, when ver is null (unresolved)", () => {
    expect(buildFeedbackPayload({ ...BASE, ver: null }).release).toBe("");
  });

  it("kind is carried through unchanged", () => {
    for (const kind of FEEDBACK_KINDS) {
      expect(buildFeedbackPayload({ ...BASE, kind }).kind).toBe(kind);
    }
  });
});

describe("FEEDBACK_KINDS / FEEDBACK_KIND_LABEL", () => {
  it("has exactly the four kinds Ben decided (R6), in label order bug/idea/question/data", () => {
    expect(FEEDBACK_KINDS).toEqual(["bug", "idea", "question", "data"]);
  });

  it("every kind has a label", () => {
    for (const kind of FEEDBACK_KINDS) {
      expect(typeof FEEDBACK_KIND_LABEL[kind]).toBe("string");
      expect(FEEDBACK_KIND_LABEL[kind].length).toBeGreaterThan(0);
    }
  });
});
