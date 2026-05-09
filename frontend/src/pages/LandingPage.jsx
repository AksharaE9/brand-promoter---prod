import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import { PageEnter, Reveal } from '../components/PageMotion';

const fallbackImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 700'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%230b1f4f'/%3E%3Cstop offset='55%25' stop-color='%231f52cc'/%3E%3Cstop offset='100%25' stop-color='%2389a7ff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='1200' height='700' fill='url(%23g)'/%3E%3Cg opacity='0.3' fill='white'%3E%3Ccircle cx='150' cy='130' r='18'/%3E%3Ccircle cx='360' cy='260' r='10'/%3E%3Ccircle cx='580' cy='150' r='24'/%3E%3Ccircle cx='770' cy='320' r='16'/%3E%3Ccircle cx='960' cy='180' r='22'/%3E%3Ccircle cx='1030' cy='410' r='14'/%3E%3C/g%3E%3Cpath d='M70 530 C220 460 350 580 500 500 C650 420 760 570 950 470 C1030 430 1110 430 1160 410' stroke='white' stroke-opacity='0.45' stroke-width='10' fill='none'/%3E%3C/svg%3E";

const floatingBits = [
  { left: '7%', top: '14%', size: 10, delay: 0, duration: 8 },
  { left: '18%', top: '62%', size: 6, delay: 0.6, duration: 10 },
  { left: '34%', top: '24%', size: 8, delay: 0.2, duration: 7.5 },
  { left: '52%', top: '18%', size: 14, delay: 1.2, duration: 11 },
  { left: '74%', top: '62%', size: 9, delay: 0.4, duration: 8.8 },
  { left: '88%', top: '31%', size: 7, delay: 1.6, duration: 9.6 },
  { left: '82%', top: '14%', size: 5, delay: 0.8, duration: 7.8 },
];

const talentBits = [
  { x: '6%', y: '20%', d: 9 },
  { x: '18%', y: '70%', d: 11 },
  { x: '39%', y: '32%', d: 8 },
  { x: '56%', y: '74%', d: 10 },
  { x: '70%', y: '20%', d: 12 },
  { x: '88%', y: '54%', d: 9 },
];

const marqueeItems = ['AI Scoring', 'Smart Shortlists', 'Interview Copilot', 'Auto Ranking', 'Skills Graph', 'Bias Guard', 'Offer Velocity'];

const LandingPage = () => {
  const navigate = useNavigate();
  const [secondaryImg, setSecondaryImg] = useState(
    'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1400&q=80',
  );
  const [heroImg, setHeroImg] = useState(
    'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=2200&q=80',
  );
  const [galleryOne, setGalleryOne] = useState(
    'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80',
  );
  const [galleryTwo, setGalleryTwo] = useState(
    'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1200&q=80',
  );
  const [galleryThree, setGalleryThree] = useState(
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80',
  );

  const { scrollYProgress } = useScroll();
  const heroY = useTransform(scrollYProgress, [0, 0.22], [0, 120]);
  const heroScale = useTransform(scrollYProgress, [0, 0.24], [1, 1.08]);
  const glassY = useTransform(scrollYProgress, [0, 0.22], [0, -40]);
  const progressX = useTransform(scrollYProgress, [0, 1], [0, 1]);

  const noisyGradient = useMemo(
    () =>
      'radial-gradient(circle at 12% 20%, rgba(84,132,255,.28), transparent 30%), radial-gradient(circle at 82% 15%, rgba(121,233,255,.18), transparent 28%), radial-gradient(circle at 74% 78%, rgba(85,104,255,.25), transparent 35%)',
    [],
  );

  return (
    <PageEnter className="min-h-screen bg-[#eef3f4] text-[#0f1f49]">
      <motion.div className="fixed left-0 right-0 top-0 h-[2px] bg-[#1f52cc] origin-left z-[80]" style={{ scaleX: progressX }} />

      <header className="relative min-h-[760px] overflow-hidden">
        <nav className="h-16 bg-white border-b border-[#e4ebf2] px-6 md:px-10 flex items-center justify-between sticky top-0 z-50 shadow-[0_1px_0_rgba(9,20,53,.05)]">
          <div className="text-[42px] leading-none font-extrabold text-[#183f96] font-[Manrope] tracking-[-0.02em]">ATS</div>
          <div className="hidden md:flex items-center gap-8 text-sm text-[#4b5876]">
            <Link to="/dashboard" className="text-[#1f4bc6] border-b-2 border-[#1f4bc6] pb-1">Platform</Link>
          </div>
          <div className="flex items-center gap-4">
            <Link className="text-sm font-medium text-[#16213f]" to="/login">Log In</Link>
            <Link className="os-btn-primary text-sm" to="/signup">Sign Up</Link>
          </div>
        </nav>

        <motion.div className="absolute inset-0" style={{ y: heroY, scale: heroScale }}>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(rgba(8,21,58,.34), rgba(8,21,58,.56)), url('${heroImg}')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div className="absolute inset-0 opacity-45" style={{ backgroundImage: noisyGradient }} />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,21,58,.07),rgba(8,21,58,.42))]" />
        </motion.div>

        {floatingBits.map((bit) => (
          <motion.span
            key={`${bit.left}-${bit.top}`}
            className="absolute rounded-full z-10"
            style={{
              left: bit.left,
              top: bit.top,
              width: bit.size,
              height: bit.size,
              background: 'rgba(183, 207, 255, 0.55)',
              boxShadow: '0 0 14px rgba(153, 188, 255, 0.45)',
            }}
            animate={{ y: [0, -12, 0], opacity: [0.55, 0.95, 0.55] }}
            transition={{ repeat: Infinity, duration: bit.duration, ease: 'easeInOut', delay: bit.delay }}
          />
        ))}

        <div className="relative z-20 max-w-[1160px] mx-auto px-6 pt-14 pb-20">
          <motion.div
            style={{ y: glassY }}
            className="mx-auto max-w-[940px] rounded-[30px] border border-white/28 bg-white/[0.05] backdrop-blur-[3px] px-8 md:px-12 py-10 text-center text-white shadow-[0_28px_58px_rgba(8,18,50,.36)]"
          >
            <div className="text-[11px] tracking-[.24em] uppercase text-[#dbe4ff] font-semibold">Next Generation Recruitment</div>
            <h1 className="mt-5 text-4xl md:text-6xl leading-[1.05] font-bold font-[Manrope]">
              The Future of <br /> Professional <span className="text-[#b9c9ff]">Hiring</span>
            </h1>
            <p className="mt-5 text-lg md:text-[2rem] text-[#d6ddf6] leading-snug max-w-3xl mx-auto">
              Deploy AI-driven workflows to identify, assess, and onboard top-tier talent in minutes, not months.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <motion.button whileHover={{ y: -2, scale: 1.02 }} whileTap={{ scale: 0.98 }} className="os-btn-primary h-12 px-8" onClick={() => { navigate('/signup'); }}>
                Start Free Trial
              </motion.button>
              <motion.button whileHover={{ y: -2, scale: 1.02 }} whileTap={{ scale: 0.98 }} className="os-btn-outline h-12 px-8 !bg-transparent border-white/35 text-white" onClick={() => { navigate('/login'); }}>
                View Demo
              </motion.button>
            </div>

            <div className="mt-8 flex flex-wrap justify-center gap-3 text-[11px] uppercase tracking-[.13em] text-[#c7d6ff]">
              <span className="px-3 py-1 rounded-full bg-white/8 border border-white/20">98% Placement Accuracy</span>
              <span className="px-3 py-1 rounded-full bg-white/8 border border-white/20">12M+ Verified Profiles</span>
              <span className="px-3 py-1 rounded-full bg-white/8 border border-white/20">Enterprise Security</span>
            </div>
          </motion.div>
        </div>
      </header>

      <section className="max-w-[1160px] mx-auto px-6 py-16">
        <Reveal>
          <h2 className="text-4xl md:text-6xl font-bold text-center font-[Manrope]">
            Precision-Engineered <span className="text-[#1d4ecc]">Intelligence</span>
          </h2>
          <p className="text-center text-[#6f7894] text-base md:text-lg mt-3">
            Tools designed for modern recruiting teams, providing clarity across every stage.
          </p>
        </Reveal>

        <div className="mt-10 grid md:grid-cols-3 gap-5">
          <Reveal className="md:col-span-2">
            <article className="os-card p-6 overflow-hidden relative">
              {talentBits.map((bit, idx) => (
                <motion.span
                  key={idx}
                  className="absolute rounded-sm bg-[#c5d7ff]/65"
                  style={{ left: bit.x, top: bit.y, width: 6, height: 6 }}
                  animate={{ y: [0, -10, 0], rotate: [0, 90, 180] }}
                  transition={{ duration: bit.d, repeat: Infinity, ease: 'easeInOut' }}
                />
              ))}
              <div className="h-full flex flex-col relative z-10">
                <h3 className="text-3xl font-semibold font-[Manrope]">Cognitive Talent Mapping</h3>
                <p className="mt-2 text-[#6f7894] leading-relaxed max-w-2xl">
                  Our neural network analyzes millions of career trajectories to predict the perfect cultural fit for your team DNA.
                </p>

                <div className="mt-6 grid md:grid-cols-[1.2fr_.8fr] gap-4 items-stretch">
                  <motion.div
                    whileHover={{ scale: 1.015 }}
                    transition={{ type: 'spring', stiffness: 220, damping: 18 }}
                    className="relative rounded-2xl w-full h-[260px] md:h-[300px] shadow-xl overflow-hidden border border-[#4d73dc]/30"
                    style={{
                      background:
                        'linear-gradient(160deg, #173989 0%, #2451c6 46%, #4f78df 100%)',
                    }}
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,rgba(255,255,255,.18),transparent_34%),radial-gradient(circle_at_84%_72%,rgba(161,203,255,.2),transparent_38%)]" />

                    {[0, 1, 2, 3, 4, 5].map((dot) => (
                      <motion.span
                        key={dot}
                        className="absolute rounded-full bg-white/35"
                        style={{
                          width: dot % 2 === 0 ? 10 : 7,
                          height: dot % 2 === 0 ? 10 : 7,
                          left: `${12 + dot * 14}%`,
                          top: `${18 + (dot % 3) * 20}%`,
                        }}
                        animate={{ y: [0, -12, 0], opacity: [0.45, 0.95, 0.45] }}
                        transition={{ duration: 5 + dot * 0.7, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    ))}

                    <svg viewBox="0 0 1000 260" className="absolute inset-x-0 bottom-0 w-full h-[58%] opacity-85">
                      <motion.path
                        d="M0,160 C110,120 180,190 290,150 C390,114 470,188 585,152 C700,116 780,188 1000,132 L1000,260 L0,260 Z"
                        fill="rgba(175,205,255,0.22)"
                        animate={{
                          d: [
                            'M0,160 C110,120 180,190 290,150 C390,114 470,188 585,152 C700,116 780,188 1000,132 L1000,260 L0,260 Z',
                            'M0,146 C105,178 196,120 300,164 C395,200 500,126 610,160 C710,190 808,132 1000,152 L1000,260 L0,260 Z',
                            'M0,160 C110,120 180,190 290,150 C390,114 470,188 585,152 C700,116 780,188 1000,132 L1000,260 L0,260 Z',
                          ]
                        }}
                        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
                      />
                      <motion.path
                        d="M0,178 C130,148 206,212 318,180 C424,150 528,206 648,176 C768,145 844,208 1000,166"
                        fill="none"
                        stroke="rgba(214,231,255,0.68)"
                        strokeWidth="7"
                        animate={{ pathLength: [0.15, 1, 0.15] }}
                        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    </svg>

                    <motion.div
                      className="absolute left-[7%] top-[18%] rounded-xl bg-white/92 text-[#18439e] px-3 py-2 shadow-[0_8px_22px_rgba(8,26,72,.22)]"
                      animate={{ y: [0, -8, 0], rotate: [0, -1.5, 0] }}
                      transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <div className="text-[10px] tracking-[.14em] uppercase font-semibold text-[#6b7faa]">Status</div>
                      <div className="mt-1 text-sm font-bold">Got Hired</div>
                    </motion.div>

                    <motion.div
                      className="absolute right-[8%] top-[30%] rounded-xl bg-[#0e2f81]/88 text-white px-3 py-2 border border-[#9ab8ff]/35"
                      animate={{ y: [0, -10, 0], x: [0, 2, 0] }}
                      transition={{ duration: 6.4, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
                    >
                      <div className="text-[10px] tracking-[.14em] uppercase text-[#c4d5ff]">Offer Sent</div>
                      <div className="mt-1 text-sm font-semibold">Accepted in 2h</div>
                    </motion.div>

                    <motion.div
                      className="absolute left-[18%] bottom-[17%] rounded-full bg-[#d8e6ff]/92 text-[#163d92] px-3 py-1.5 text-xs font-semibold"
                      animate={{ x: [0, 14, 0], opacity: [0.8, 1, 0.8] }}
                      transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      +1 Hired
                    </motion.div>
                  </motion.div>

                  <div className="grid gap-4 h-full">
                    <motion.img
                      whileHover={{ scale: 1.015 }}
                      transition={{ type: 'spring', stiffness: 220, damping: 18 }}
                      alt="Talent dashboard"
                      className="rounded-2xl w-full h-[140px] object-cover shadow-lg"
                      src={secondaryImg}
                      onError={() => setSecondaryImg(fallbackImage)}
                    />
                    <div className="rounded-2xl bg-[linear-gradient(135deg,#0b1f4f,#1f52cc)] text-white p-4 border border-[#365fd3] shadow-lg">
                      <div className="text-[11px] uppercase tracking-[.14em] text-[#b9ceff]">Live Index</div>
                      <div className="mt-3 text-3xl font-bold font-[Manrope]">+42</div>
                      <div className="text-sm text-[#dbe6ff] mt-1">Qualified candidates this week</div>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          </Reveal>

          <div className="flex flex-col gap-5">
            <Reveal delay={0.04}>
              <motion.article whileHover={{ y: -3 }} className="rounded-3xl bg-[#2555d9] text-white p-6 min-h-[240px] shadow-[0_20px_40px_rgba(32,79,208,.25)]">
                <motion.span
                  className="material-symbols-outlined text-3xl"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                  animate={{ rotate: [0, 8, -6, 0] }}
                  transition={{ repeat: Infinity, duration: 6, ease: 'easeInOut' }}
                >
                  verified
                </motion.span>
                <h4 className="text-3xl font-semibold font-[Manrope] mt-5">Automated Verification</h4>
                <p className="text-sm mt-3 text-[#dce6ff]">Instant background checks and skill verification via secure verification flows.</p>
              </motion.article>
            </Reveal>
            <Reveal delay={0.08}>
              <motion.article whileHover={{ y: -3 }} className="os-card p-6 min-h-[200px]">
                <div className="text-sm">Active teams +12</div>
                <h4 className="text-3xl font-semibold font-[Manrope] mt-4">Active Pipelines</h4>
                <p className="text-sm mt-3 text-[#6f7894]">Real-time collaboration across hiring managers and sourcing teams.</p>
                <div className="mt-5 h-2 rounded-full bg-[#edf2fb] overflow-hidden">
                  <motion.div initial={{ width: 0 }} whileInView={{ width: '82%' }} viewport={{ once: true }} transition={{ duration: 1.1 }} className="h-full rounded-full bg-[#1f52cc]" />
                </div>
              </motion.article>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="max-w-[1160px] mx-auto px-6 pb-16">
        <Reveal>
          <div className="os-eyebrow">Immersive Workspace</div>
          <h3 className="mt-2 text-4xl md:text-5xl font-bold font-[Manrope]">A richer hiring surface with live visual context.</h3>
        </Reveal>

        <div className="mt-8 grid md:grid-cols-12 gap-5">
          <Reveal className="md:col-span-7">
            <motion.img
              whileHover={{ scale: 1.01 }}
              transition={{ type: 'spring', stiffness: 210, damping: 18 }}
              className="w-full h-[260px] md:h-[340px] rounded-3xl object-cover shadow-[0_20px_40px_rgba(13,35,91,.14)]"
              src={galleryOne}
              onError={() => setGalleryOne(fallbackImage)}
              alt="Hiring collaboration"
            />
          </Reveal>
          <Reveal className="md:col-span-5" delay={0.05}>
            <div className="grid gap-5">
              <motion.img
                whileHover={{ scale: 1.01 }}
                transition={{ type: 'spring', stiffness: 210, damping: 18 }}
                className="w-full h-[160px] rounded-3xl object-cover shadow-[0_16px_32px_rgba(13,35,91,.12)]"
                src={galleryTwo}
                onError={() => setGalleryTwo(fallbackImage)}
                alt="Recruitment metrics"
              />
              <motion.img
                whileHover={{ scale: 1.01 }}
                transition={{ type: 'spring', stiffness: 210, damping: 18 }}
                className="w-full h-[160px] rounded-3xl object-cover shadow-[0_16px_32px_rgba(13,35,91,.12)]"
                src={galleryThree}
                onError={() => setGalleryThree(fallbackImage)}
                alt="Talent interviews"
              />
            </div>
          </Reveal>
        </div>

        <motion.div className="mt-6 rounded-2xl border border-[#dde6f2] bg-white overflow-hidden" whileHover={{ y: -2 }}>
          <motion.div
            className="flex gap-3 p-4 min-w-max"
            animate={{ x: ['0%', '-50%'] }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          >
            {[...marqueeItems, ...marqueeItems].map((item, idx) => (
              <span key={`${item}-${idx}`} className="px-3 py-1 rounded-full text-xs font-semibold tracking-[.1em] uppercase bg-[#edf3ff] text-[#1e4ecc] border border-[#d8e6ff]">
                {item}
              </span>
            ))}
          </motion.div>
        </motion.div>
      </section>

      <section className="bg-[#eaf0f1] py-20 overflow-hidden relative">
        <motion.div
          className="absolute -top-16 -left-16 w-64 h-64 rounded-full bg-[#dfe8ff]/70 blur-3xl"
          animate={{ x: [0, 30, 0], y: [0, -18, 0] }}
          transition={{ repeat: Infinity, duration: 16, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-16 -right-16 w-72 h-72 rounded-full bg-[#cce6ff]/60 blur-3xl"
          animate={{ x: [0, -28, 0], y: [0, 16, 0] }}
          transition={{ repeat: Infinity, duration: 18, ease: 'easeInOut' }}
        />

        <div className="max-w-[1160px] mx-auto px-6 grid lg:grid-cols-2 gap-10 items-center relative z-10">
          <Reveal>
            <div className="os-card p-4 overflow-hidden">
              <motion.img
                whileHover={{ scale: 1.02 }}
                transition={{ type: 'spring', stiffness: 220, damping: 18 }}
                className="w-full rounded-2xl h-[320px] object-cover"
                src={heroImg}
                onError={() => setHeroImg(fallbackImage)}
                alt="Enterprise analytics view"
              />
            </div>
          </Reveal>
          <Reveal delay={0.06}>
            <div>
              <div className="os-eyebrow">Enterprise Suite</div>
              <h3 className="text-5xl md:text-6xl font-bold leading-[1.05] mt-2 font-[Manrope]">
                Built for the <span className="text-[#1d4ecc] italic">Highest</span> Performance Teams.
              </h3>
              <p className="mt-4 text-[#5f6b86] leading-relaxed">
                ATS is not just a database. It is an intelligent engine that understands your company culture and technical requirements.
              </p>
              <ul className="mt-5 space-y-2 text-[#1f2d4f]">
                <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#1f4bc6]" /> Generative Interviewing</li>
                <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#1f4bc6]" /> Unbiased Sourcing</li>
                <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#1f4bc6]" /> Stage-aware hiring intelligence</li>
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="max-w-[1160px] mx-auto px-6 py-10 flex flex-col md:flex-row md:items-center justify-between gap-4 text-sm text-[#6c7691]">
        <div>
          <div className="font-semibold text-[#17337d] text-xl">ATS</div>
          <div className="mt-1">(c) 2024 ATS Technologies. All rights reserved.</div>
        </div>
        <div className="flex flex-wrap gap-5"><a href="#">Privacy Policy</a><a href="#">Terms of Service</a><a href="#">Security</a><a href="#">Cookie Settings</a></div>
      </footer>
    </PageEnter>
  );
};

export default LandingPage;
