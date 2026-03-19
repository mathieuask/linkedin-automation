/**
 * HumanMouse V3 - Corrections scroll LinkedIn
 * - Force scroll sur conteneur .scaffold-layout__main
 * - Vérification scrollTop réel
 * - Même comportement V2 pour mousemove
 */

class HumanMouseV3 {
  constructor(page) {
    this.page = page;
    this.lastX = 100;
    this.lastY = 100;
    this.eventCount = 0;
  }

  resetEventCount() {
    this.eventCount = 0;
  }

  getEventCount() {
    return this.eventCount;
  }

  /**
   * Timing log-normal (heavy tail, non-uniforme)
   */
  logNormalDelay(median, sigma) {
    const mu = Math.log(median);
    const normal = this.gaussianRandom(0, sigma);
    return Math.max(50, Math.exp(mu + normal));
  }

  gaussianRandom(mean, stdDev) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  gaussianJitter(sigma) {
    return this.gaussianRandom(0, sigma);
  }

  velocityProfile(t) {
    return 1 - Math.pow(2 * t - 1, 4);
  }

  async moveTo(targetX, targetY, options = {}) {
    const { steps = 30 + Math.floor(Math.random() * 20) } = options;
    const startX = this.lastX;
    const startY = this.lastY;

    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const velocity = this.velocityProfile(progress);

      let x = startX + (targetX - startX) * progress;
      let y = startY + (targetY - startY) * progress;

      x += this.gaussianJitter(0.5);
      y += this.gaussianJitter(0.5);

      await this.page.mouse.move(x, y);
      this.eventCount++;

      const delay = this.logNormalDelay(20, 0.3) / velocity;
      await this.page.waitForTimeout(delay);
    }

    this.lastX = targetX;
    this.lastY = targetY;
  }

  async randomMove() {
    const targetX = 200 + Math.random() * 800;
    const targetY = 200 + Math.random() * 400;
    await this.moveTo(targetX, targetY);
  }

  async ambientMovements(durationMs) {
    const startTime = Date.now();

    while (Date.now() - startTime < durationMs) {
      const deltaX = (Math.random() - 0.5) * 50;
      const deltaY = (Math.random() - 0.5) * 50;

      const targetX = this.lastX + deltaX;
      const targetY = this.lastY + deltaY;

      await this.page.mouse.move(targetX, targetY);
      this.eventCount++;

      await this.page.waitForTimeout(this.logNormalDelay(200, 0.5));
    }
  }

  /**
   * Scroll CORRIGÉ - Force scroll sur conteneur LinkedIn
   */
  async scrollWithMovement(deltaY, options = {}) {
    const {
      chunks = Math.ceil(Math.abs(deltaY) / 100),
      paceType = Math.random() < 0.3 ? 'fast' : 'slow'
    } = options;

    const chunkSize = deltaY / chunks;
    const paceDelay = paceType === 'fast' ?
      this.logNormalDelay(50, 0.3) :
      this.logNormalDelay(200, 0.5);

    for (let i = 0; i < chunks; i++) {
      // 1. Wheel event (peut ne pas fonctionner sur conteneur interne)
      await this.page.mouse.wheel(0, chunkSize);

      // 2. FORCE scroll sur conteneur LinkedIn
      await this.page.evaluate((dy) => {
        const container = document.querySelector('.scaffold-layout__main');
        if (container) {
          container.scrollBy(0, dy);
        } else {
          window.scrollBy(0, dy);
        }
      }, chunkSize);

      // 3. Mouvements curseur pendant scroll
      if (Math.random() < 0.7) {
        const deltaX = (Math.random() - 0.5) * 30;
        const deltaYMouse = (Math.random() - 0.5) * 20;

        await this.page.mouse.move(this.lastX + deltaX, this.lastY + deltaYMouse);
        this.lastX += deltaX;
        this.lastY += deltaYMouse;
        this.eventCount++;
      }

      await this.page.waitForTimeout(paceDelay);
    }

    // Overshoot 10-15%
    if (Math.random() < 0.12) {
      await this.page.waitForTimeout(this.logNormalDelay(100, 0.3));
      await this.page.evaluate((dy) => {
        const container = document.querySelector('.scaffold-layout__main');
        if (container) {
          container.scrollBy(0, dy);
        } else {
          window.scrollBy(0, dy);
        }
      }, -chunkSize * (1 + Math.random()));
    }
  }

  /**
   * Obtenir position scroll RÉELLE (conteneur OU window)
   */
  async getScrollPosition() {
    return await this.page.evaluate(() => {
      const container = document.querySelector('.scaffold-layout__main');
      if (container) {
        return {
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
          source: 'container'
        };
      }
      return {
        scrollTop: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: window.innerHeight,
        source: 'window'
      };
    });
  }

  async clickElement(element, options = {}) {
    const { errorRate = 0.03 } = options;

    const box = await element.boundingBox();
    if (!box) return false;

    const targetX = box.x + box.width / 2 + this.gaussianJitter(3);
    const targetY = box.y + box.height / 2 + this.gaussianJitter(3);

    await this.moveTo(targetX, targetY);

    if (Math.random() < errorRate) {
      const missX = targetX + (Math.random() - 0.5) * box.width;
      const missY = targetY + (Math.random() - 0.5) * box.height;
      await this.page.mouse.click(missX, missY);
      await this.page.waitForTimeout(this.logNormalDelay(100, 0.3));
      await this.page.mouse.click(targetX, targetY);
    } else {
      await this.page.mouse.click(targetX, targetY);
    }

    this.eventCount++;
    return true;
  }

  async hoverWithoutClick(element) {
    const box = await element.boundingBox();
    if (!box) return;

    const targetX = box.x + box.width / 2 + this.gaussianJitter(2);
    const targetY = box.y + box.height / 2 + this.gaussianJitter(2);

    await this.moveTo(targetX, targetY);

    const hoverDuration = this.logNormalDelay(1000, 0.6);
    await this.ambientMovements(Math.min(hoverDuration, 3000));
  }
}

module.exports = { HumanMouseV3 };
