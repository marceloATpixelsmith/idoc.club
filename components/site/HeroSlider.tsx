'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type Slide = {
  image: string;
  alt: string;
  focal: string;
  eyebrow: string;
  title: string;
  titleAccent: string;
  body: string;
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
};

const slides: Slide[] = [
  {
    image: '/hero-horse.jpg',
    alt: 'Dressage horse portrait in low light',
    focal: '70% 30%',
    eyebrow: 'Founded 1990 · Brecht, Belgium',
    title: 'International Dressage',
    titleAccent: 'Officials Club',
    body: 'Promoting the principles of horsemanship and furthering the education of judges, stewards and veterinarians in dressage sport worldwide.',
    primary: { label: 'Become a Member', href: '/membership' },
    secondary: { label: 'What is IDOC', href: '/about' },
  },
  {
    image: '/hero-seminar.jpg',
    alt: 'Dressage rider in extended trot in a dim arena',
    focal: '55% 50%',
    eyebrow: 'Seminars & Courses 2026',
    title: 'Education that keeps',
    titleAccent: 'officials aligned',
    body: 'Maintenance courses, young horse seminars and para dressage transfer-up courses — from Falsterbo to Verden and Hartpury. Members receive priority information and registration details.',
    primary: { label: 'View Seminars', href: '/seminars' },
    secondary: { label: 'Membership Benefits', href: '/membership' },
  },
  {
    image: '/hero-membership.jpg',
    alt: 'Dressage arena marker in raked sand at dusk',
    focal: '60% 55%',
    eyebrow: 'Membership',
    title: 'Join officials from',
    titleAccent: 'more than 40 nations',
    body: "Judges, stewards and veterinarians share one club: seminar registration, IDOC documents, General Assembly papers and the officials' directory in the member area.",
    primary: { label: 'Become a Member', href: '/membership' },
    secondary: { label: 'Member Login', href: '/sign-in' },
  },
];

const DURATION = 7500;

export function HeroSlider() {
  const [index, setIndex] = useState(0);

  const go = useCallback((next: number) => {
    setIndex(((next % slides.length) + slides.length) % slides.length);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => go(index + 1), DURATION);
    return () => window.clearTimeout(t);
  }, [index, go]);

  return (
    <section
      className="relative overflow-hidden border-b border-border"
      aria-roledescription="carousel"
      aria-label="IDOC highlights"
    >
      {/* Images */}
      <div className="absolute inset-0">
        {slides.map((slide, i) => (
          <div
            key={slide.image}
            aria-hidden={i !== index}
            className={`absolute inset-0 transition-opacity duration-[1400ms] ease-in-out ${
              i === index ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- full-bleed hero background, not a content image */}
            <img
              src={slide.image}
              alt={slide.alt}
              {...(i === 0 ? {} : { loading: 'lazy' as const })}
              className="h-full w-full object-cover"
              style={{
                objectPosition: slide.focal,
                animation: i === index ? 'hero-zoom 16s ease-out forwards' : undefined,
              }}
            />
            <div className="hero-veil absolute inset-0" />
          </div>
        ))}
      </div>

      {/* Copy */}
      <div className="relative mx-auto flex min-h-[78vh] max-w-7xl flex-col justify-center px-5 py-24 lg:px-8">
        {slides.map((slide, i) =>
          i === index ? (
            <div key={slide.title} className="max-w-2xl">
              <p className="eyebrow hero-rise" style={{ animationDelay: '80ms' }}>
                {slide.eyebrow}
              </p>
              <h1 className="mt-6 text-5xl leading-[1.05] sm:text-6xl lg:text-7xl">
                <span className="hero-rise block" style={{ animationDelay: '220ms' }}>
                  {slide.title}
                </span>
                <span
                  className="hero-rise block text-gold"
                  style={{ animationDelay: '360ms' }}
                >
                  {slide.titleAccent}
                </span>
              </h1>
              <p
                className="hero-rise mt-7 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg"
                style={{ animationDelay: '520ms' }}
              >
                {slide.body}
              </p>
              <div
                className="hero-rise mt-10 flex flex-wrap gap-4"
                style={{ animationDelay: '680ms' }}
              >
                <Link
                  href={slide.primary.href}
                  className="rounded-full bg-gold px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground transition-opacity hover:opacity-90"
                >
                  {slide.primary.label}
                </Link>
                <Link
                  href={slide.secondary.href}
                  className="rounded-full border border-border px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition-colors hover:border-gold/60 hover:text-gold"
                >
                  {slide.secondary.label}
                </Link>
              </div>
            </div>
          ) : null,
        )}

        {/* Controls */}
        <div className="mt-16 flex items-center gap-6">
          <div className="flex items-center gap-3">
            {slides.map((slide, i) => (
              <button
                key={slide.image}
                type="button"
                aria-label={`Show slide ${i + 1}`}
                aria-current={i === index}
                onClick={() => go(i)}
                className="group h-px w-12 bg-border"
              >
                <span
                  className={`block h-px bg-gold transition-all duration-500 ${
                    i === index ? 'w-full' : 'w-0 group-hover:w-1/2'
                  }`}
                />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous slide"
              onClick={() => go(index - 1)}
              className="border border-border p-2 text-muted-foreground transition-colors hover:border-gold/60 hover:text-gold"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Next slide"
              onClick={() => go(index + 1)}
              className="border border-border p-2 text-muted-foreground transition-colors hover:border-gold/60 hover:text-gold"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
