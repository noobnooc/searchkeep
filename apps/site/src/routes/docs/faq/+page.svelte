<script lang="ts">
  import { FAQS } from '#lib/content.ts';
  import { GITHUB } from '#lib/site.ts';

  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
</script>

<h2 id="questions" class="visually-hidden">Questions</h2>
{#each FAQS as f (f.q)}
  <section class="qa" aria-labelledby={slug(f.q)}>
    <h3 id={slug(f.q)}>{f.q}</h3>
    <p>{f.a}</p>
  </section>
{/each}

<p class="more">
  Didn’t find your answer? Open an <a href={GITHUB.issues}>issue on GitHub</a>.
</p>

<style>
  .qa + .qa {
    margin-top: 0;
    border-top: 1px solid var(--line);
  }
  .qa {
    padding-block: 1.4em;
  }
  .qa:first-of-type {
    padding-top: 0;
  }
  .qa h3 {
    margin-top: 0;
  }
  .qa p {
    margin-top: 0.5em;
  }
  .more {
    padding-top: 1.4em;
    border-top: 1px solid var(--line);
  }
</style>
