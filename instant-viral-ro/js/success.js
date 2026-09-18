'use strict';

document.addEventListener('DOMContentLoaded', () => {
  initConfetti();
  initParticles();
  parseOrderData();
});

function parseOrderData() {
  const orderData = JSON.parse(sessionStorage.getItem('lastOrder') || '{}');
  const serviceNameEl = document.getElementById('serviceName');
  const orderQtyEl = document.getElementById('orderQty');

  if (serviceNameEl) {
    serviceNameEl.textContent = orderData.serviceName || '—';
  }
  if (orderQtyEl) {
    orderQtyEl.textContent = (orderData.qty || 0).toLocaleString('en-US');
  }
}

function initConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];
  const COLORS = ['#6C63FF', '#3ECFCF', '#22c55e', '#fbbf24', '#f472b6'];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  class P {
    constructor() {
      this.x = canvas.width / 2 + (Math.random() - 0.5) * 200;
      this.y = canvas.height / 2 - 100;
      this.vx = (Math.random() - 0.5) * 15;
      this.vy = -Math.random() * 15 - 5;
      this.gravity = 0.3;
      this.drag = 0.96;
      this.size = Math.random() * 8 + 4;
      this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
      this.rotation = Math.random() * 360;
      this.rs = (Math.random() - 0.5) * 10;
      this.life = 1;
      this.decay = Math.random() * 0.01 + 0.005;
    }
    update() {
      this.vx *= this.drag;
      this.vy *= this.drag;
      this.vy += this.gravity;
      this.x += this.vx;
      this.y += this.vy;
      this.rotation += this.rs;
      this.life -= this.decay;
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation * Math.PI / 180);
      ctx.globalAlpha = this.life;
      ctx.fillStyle = this.color;
      ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size * 0.6);
      ctx.restore();
    }
  }

  for (let i = 0; i < 150; i++) particles.push(new P());

  setInterval(() => {
    if (particles.length < 200) {
      const p = new P();
      p.y = -20;
      p.vy = Math.random() * 3 + 2;
      p.vx = (Math.random() - 0.5) * 2;
      p.gravity = 0.1;
      particles.push(p);
    }
  }, 300);

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter(p => p.life > 0 && p.y < canvas.height + 50);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(animate);
  }
  animate();
}

function initParticles() {
  const canvas = document.getElementById('successParticles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  class P {
    constructor() { this.reset(); }
    reset() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.size = Math.random() * 2 + 0.5;
      this.sx = (Math.random() - 0.5) * 0.3;
      this.sy = (Math.random() - 0.5) * 0.3;
      this.opacity = Math.random() * 0.5 + 0.2;
    }
    update() {
      this.x += this.sx;
      this.y += this.sy;
      if (this.x < 0 || this.x > canvas.width) this.sx *= -1;
      if (this.y < 0 || this.y > canvas.height) this.sy *= -1;
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(108,99,255,${this.opacity})`;
      ctx.fill();
    }
  }

  for (let i = 0; i < 50; i++) particles.push(new P());

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(animate);
  }
  animate();
}
