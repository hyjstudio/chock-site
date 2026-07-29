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

test("#download deep links, clicks, and hash changes reveal only that section", () => {
  for (const entry of ["deep-link", "click", "hashchange"]) {
    const page = runRevealPolicy(entry === "deep-link" ? "#download" : "");
    if (entry === "click") {
      page.downloadClick();
      page.downloadClick();
      assert.equal(page.location.hash, "");
    }
    if (entry === "hashchange") {
      page.location.hash = "#download";
      page.hashchange();
    }

    for (const el of page.downloadRevealEls) {
      assert.equal(el.dataset.revealImmediate, "true", entry);
      assert.equal(el.style.opacity, "1", entry);
      assert.equal(el.style.visibility, "visible", entry);
      assert.equal(el.style.transform, undefined, entry);
      assert.equal(page.policy.shouldAnimateReveal(el), false, entry);
    }
    assert.equal(page.policy.shouldAnimateReveal(page.unrelatedReveal), true, entry);
  }
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

test("normal scrolling keeps the download section in the shared reveal batch", () => {
  const page = runRevealPolicy("");

  assert.match(index, /document\.querySelectorAll\("#download \.reveal"\)/);
  assert.equal(page.downloadRevealEls.length, 3);
  for (const el of page.downloadRevealEls) {
    assert.equal(page.policy.shouldAnimateReveal(el), true);
  }
});

function runRevealPolicy(hash) {
  const card = { dataset: {}, style: {} };
  const downloadRevealEls = Array.from({ length: 3 }, () => ({
    dataset: {},
    style: { transform: "translate3d(0px, 44px, 0px)" }
  }));
  const unrelatedReveal = { dataset: {}, style: {} };
  let downloadClick;
  const location = { hash };
  const killedTweens = [];
  const hashchangeListeners = [];

  const context = {
    document: {
      querySelector(selector) {
        assert.equal(selector, "#douyin .douyin-card");
        return card;
      },
      querySelectorAll(selector) {
        if (selector === "#download .reveal") return downloadRevealEls;
        if (selector === 'a[href="#download"]') {
          return [{
            addEventListener(type, listener) {
              assert.equal(type, "click");
              downloadClick = listener;
            }
          }];
        }
        assert.fail(`Unexpected selector: ${selector}`);
      }
    },
    gsap: {
      killTweensOf(target) {
        killedTweens.push(target);
      },
      set(target, vars) {
        target.style.opacity = String(vars.opacity);
        target.style.visibility = vars.visibility;
        if (vars.clearProps === "transform") delete target.style.transform;
      }
    },
    location,
    window: {
      addEventListener(type, listener) {
        assert.equal(type, "hashchange");
        hashchangeListeners.push(listener);
      }
    }
  };

  vm.runInNewContext(
    `${policyMatch[1]}\n;globalThis.__policy = { shouldAnimateReveal, showDownloadImmediately, showDownloadFromHash, showDouyinCardImmediately };`,
    context
  );

  return {
    card,
    downloadClick,
    downloadRevealEls,
    hashchange() {
      hashchangeListeners.forEach((listener) => listener());
    },
    killedTweens,
    location,
    policy: context.__policy,
    unrelatedReveal
  };
}
