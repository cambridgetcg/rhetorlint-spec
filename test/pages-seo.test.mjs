import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../apps/explorer/index.html", import.meta.url), "utf8");
const ROBOTS = readFileSync(new URL("../apps/explorer/robots.txt", import.meta.url), "utf8");
const SITEMAP = readFileSync(new URL("../apps/explorer/sitemap.xml", import.meta.url), "utf8");
const WORKFLOW = readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
const CARD = readFileSync(new URL("../apps/explorer/social-card.png", import.meta.url));
const ORIGIN = "https://cambridgetcg.github.io/rhetorlint-spec/";

function meta(attribute, key) {
  const pattern = new RegExp(
    `<meta\\s+${attribute}="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s+content="([^"]*)">`,
  );
  return INDEX.match(pattern)?.[1] ?? null;
}

test("the People Door has one matching canonical and social identity", () => {
  assert.ok(INDEX.includes(`<link rel="canonical" href="${ORIGIN}">`));
  assert.equal(meta("property", "og:url"), ORIGIN);
  assert.equal(meta("property", "og:title"), "RhetorLint · Read the subtext");
  assert.equal(meta("name", "twitter:title"), "RhetorLint · Read the subtext");
  assert.equal(meta("property", "og:image"), `${ORIGIN}social-card.png`);
  assert.equal(meta("property", "og:image:alt"), meta("name", "twitter:image:alt"));
  assert.equal(meta("property", "og:image:width"), "1200");
  assert.equal(meta("property", "og:image:height"), "630");
  assert.equal(meta("property", "og:image:type"), "image/png");
});

test("the social card is the advertised 1200 by 630 PNG", () => {
  assert.deepEqual([...CARD.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(CARD.readUInt32BE(16), 1200);
  assert.equal(CARD.readUInt32BE(20), 630);
});

test("robots, sitemap, and deployment carry the same public doors", () => {
  assert.match(ROBOTS, /User-agent: \*\nAllow: \//);
  assert.ok(ROBOTS.includes(`Sitemap: ${ORIGIN}sitemap.xml`));
  assert.ok(SITEMAP.includes(`<loc>${ORIGIN}</loc>`));
  assert.ok(SITEMAP.includes(`<loc>${ORIGIN}bookmarklet.html</loc>`));
  assert.match(
    SITEMAP,
    /<loc>https:\/\/cambridgetcg\.github\.io\/rhetorlint-spec\/bookmarklet\.html<\/loc>\s*<lastmod>2026-07-27<\/lastmod>/,
  );
  for (const name of ["robots.txt", "sitemap.xml", "social-card.png"]) {
    assert.ok(WORKFLOW.includes(`apps/explorer/${name}`), `${name} triggers and enters Pages`);
    assert.ok(WORKFLOW.includes(`_site/${name}`), `${name} is copied to the deployed root`);
  }
});

test("Claim Feedback is discoverable without deploying a claim or a second app", () => {
  const feedbackLink = "https://github.com/cambridgetcg/rhetorlint-spec/blob/main/examples/claim-feedback/README.md";
  assert.ok(INDEX.includes('id="claim-feedback"'));
  assert.ok(INDEX.includes(`href="${feedbackLink}"`));
  assert.match(
    INDEX,
    /local Claim Feedback example[\s\S]*one bounded packet[\s\S]*does not crawl[\s\S]*score a person[\s\S]*write KARMA[\s\S]*train a model/,
  );
  assert.ok(!INDEX.includes("examples/claim-feedback/fixtures/"));
  assert.ok(!INDEX.includes("We always review every submitted report within 48 hours."));
  assert.ok(!WORKFLOW.includes("examples/claim-feedback/"));
  assert.ok(!WORKFLOW.includes("fixtures/"));
  assert.match(
    SITEMAP,
    /<loc>https:\/\/cambridgetcg\.github\.io\/rhetorlint-spec\/<\/loc>\s*<lastmod>2026-08-16<\/lastmod>/,
  );
  assert.ok(!SITEMAP.includes("#claim-feedback"));
});

test("structured data describes the actual free on-device web application", () => {
  const match = INDEX.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(match, "JSON-LD exists");
  const data = JSON.parse(match[1]);
  assert.equal(data["@type"], "WebApplication");
  assert.equal(data.url, ORIGIN);
  assert.equal(data.isAccessibleForFree, true);
  assert.match(data.description, /on-device/);
});
