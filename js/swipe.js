export function resetCardTransform(cardEl, leftBadge, rightBadge, instant = false) {
  if (!cardEl) return;
  cardEl.classList.remove('swiping-left', 'swiping-right', 'btn-fly-out');

  if (instant) {
    cardEl.classList.remove('spring-back');
    cardEl.style.transition = 'none';
    cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
    cardEl.style.opacity = '1';
    void cardEl.offsetWidth;
    cardEl.style.transition = '';
  } else {
    cardEl.classList.add('spring-back');
    cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
    cardEl.style.opacity = '1';
  }

  if (leftBadge) {
    leftBadge.style.opacity = '0';
    leftBadge.classList.remove('is-ready');
  }
  if (rightBadge) {
    rightBadge.style.opacity = '0';
    rightBadge.classList.remove('is-ready');
  }
}

export function bindCardGestures({
  cardEl,
  leftBadge,
  rightBadge,
  canSwipeJudge,
  onSwipeJudge,
  onSwipeDownUndo,
  onTapFlip,
  onTapCloze,
  onTapImage,
  haptic
}) {
  if (!cardEl) return;

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let tracking = false;
  let axis = null; // 'x' | 'y'
  let thresholdPassed = false;
  let suppressClickUntil = 0;

  const isInteractive = (target) =>
    Boolean(target && target.closest('button, input, textarea, select, .cloze-blank, .card-img'));

  cardEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || isInteractive(e.target)) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    currentX = 0;
    currentY = 0;
    tracking = true;
    axis = null;
    thresholdPassed = false;
    cardEl.classList.remove('spring-back');
  }, { passive: true });

  cardEl.addEventListener('touchmove', (e) => {
    if (!tracking || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (!axis) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.2) {
        // Allow scroll inside card-scroll-body if scrollable
        const scroller = e.target.closest('.card-scroll-body');
        if (scroller && scroller.scrollTop > 2) {
          tracking = false;
          return;
        }
        axis = 'y';
      } else if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (!canSwipeJudge()) {
          tracking = false;
          return;
        }
        axis = 'x';
      } else {
        return;
      }
    }

    if (axis === 'y') {
      currentY = dy;
      return;
    }

    if (axis === 'x') {
      e.preventDefault();
      currentX = dx;
      const threshold = Math.max(96, cardEl.clientWidth * 0.27);
      const ratio = Math.min(1, Math.abs(dx) / threshold);
      const isReady = ratio >= 1;

      if (isReady && !thresholdPassed) {
        thresholdPassed = true;
        haptic(14);
      } else if (!isReady) {
        thresholdPassed = false;
      }

      cardEl.style.transform = `translate3d(${dx}px, ${Math.abs(dx) * 0.03}px, 0) rotate(${dx * 0.03}deg)`;
      cardEl.classList.toggle('swiping-right', dx > 12);
      cardEl.classList.toggle('swiping-left', dx < -12);

      if (rightBadge) {
        rightBadge.style.opacity = dx > 0 ? String(ratio) : '0';
        rightBadge.classList.toggle('is-ready', dx > 0 && isReady);
      }
      if (leftBadge) {
        leftBadge.style.opacity = dx < 0 ? String(ratio) : '0';
        leftBadge.classList.toggle('is-ready', dx < 0 && isReady);
      }
    }
  }, { passive: false });

  const finishTouch = () => {
    if (!tracking) return;
    tracking = false;

    if (axis === 'y' && currentY > 95) {
      suppressClickUntil = Date.now() + 300;
      onSwipeDownUndo();
      return;
    }

    if (axis === 'x') {
      suppressClickUntil = Date.now() + 320;
      const threshold = Math.max(96, cardEl.clientWidth * 0.27);
      if (canSwipeJudge() && Math.abs(currentX) >= threshold) {
        const isRight = currentX > 0;
        haptic(16);
        cardEl.classList.add('btn-fly-out');
        cardEl.style.transform = `translate3d(${isRight ? 480 : -480}px, 24px, 0) rotate(${isRight ? 15 : -15}deg)`;
        cardEl.style.opacity = '0.12';
        onSwipeJudge(isRight);
        return;
      }
    }
    resetCardTransform(cardEl, leftBadge, rightBadge, false);
  };

  cardEl.addEventListener('touchend', finishTouch);
  cardEl.addEventListener('touchcancel', finishTouch);

  cardEl.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) return;
    const imgEl = e.target.closest('.card-img');
    if (imgEl && imgEl.src) {
      e.stopPropagation();
      onTapImage(imgEl.src);
      return;
    }
    const cloze = e.target.closest('.cloze-blank');
    if (cloze) {
      if (onTapCloze(cloze)) return;
    }
    if (isInteractive(e.target)) return;
    onTapFlip();
  });
}
