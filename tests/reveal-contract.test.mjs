import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const policyMatch = index.match(
  /\/\* ---------- reveal 可见性策略 ---------- \*\/([\s\S]*?)\/\* ---------- reveal 可见性策略结束 ---------- \*\//
);

assert.ok(policyMatch, "index.html must include the reveal visibility policy");

test("initial #douyin deep links show the card without an entrance tween", () => {
  const page = runRevealPolicy("#douyin");

  assert.equal(page.card.dataset.revealImmediate, "true");
  assert.deepEqual(page.card.style, {
    opacity: "1",
    visibility: "visible",
    transform: "none"
  });
  assert.deepEqual(page.killedTweens, [page.card]);
  assert.equal(page.policy.shouldAnimateReveal(page.card), false);
});

test("hashchange to #douyin immediately opts the card out of reveal", () => {
  const page = runRevealPolicy("");

  assert.equal(page.card.dataset.revealImmediate, undefined);
  assert.equal(page.policy.shouldAnimateReveal(page.card), true);

  page.location.hash = "#douyin";
  page.hashchange();

  assert.equal(page.card.dataset.revealImmediate, "true");
  assert.equal(page.card.style.opacity, "1");
  assert.equal(page.card.style.visibility, "visible");
  assert.equal(page.card.style.transform, "none");
  assert.deepEqual(page.killedTweens, [page.card]);
  assert.equal(page.policy.shouldAnimateReveal(page.card), false);
});

test("normal scrolling keeps the Douyin card in the shared reveal batch", () => {
  const page = runRevealPolicy("");

  assert.match(index, /<div class="douyin-card reveal">/);
  assert.match(index, /ScrollTrigger\.batch\("\.reveal", \{/);
  assert.match(index, /const animatedEls = els\.filter\(shouldAnimateReveal\);/);
  assert.equal(page.policy.shouldAnimateReveal(page.card), true);
});

test("direct #license links reveal the pricing section immediately", () => {
  assert.match(index, /function showLicenseImmediately\(\)/);
  assert.match(index, /location\.hash !== "#license"/);
  assert.match(index, /document\.querySelectorAll\("#license \.reveal"\)/);
  assert.match(index, /window\.addEventListener\("hashchange", showLicenseImmediately\)/);
});

function runRevealPolicy(hash) {
  const card = { dataset: {}, style: {} };
  const location = { hash };
  const killedTweens = [];
  let hashchange;

  const context = {
    document: {
      querySelector(selector) {
        assert.equal(selector, "#douyin .douyin-card");
        return card;
      }
    },
    gsap: {
      killTweensOf(target) {
        killedTweens.push(target);
      }
    },
    location,
    window: {
      addEventListener(type, listener) {
        assert.equal(type, "hashchange");
        hashchange = listener;
      }
    }
  };

  vm.runInNewContext(
    `${policyMatch[1]}\n;globalThis.__policy = { shouldAnimateReveal, showDouyinCardImmediately };`,
    context
  );

  return {
    card,
    hashchange,
    killedTweens,
    location,
    policy: context.__policy
  };
}
