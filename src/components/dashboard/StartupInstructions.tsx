// Startup instruction copy shown in the "Start new inspection" pop-up (FR-009).
// Content from idea/veriffica-instruction.md — kept faithful to the source,
// including the two-section structure, the answer-button meanings, the worked
// example, and the interpretation guidance. English-only (FR-024). Curly quotes
// and apostrophes avoid react/no-unescaped-entities escaping noise.
export function StartupInstructions() {
  return (
    <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1 text-sm text-blue-100/70 [&_strong]:text-white">
      <p>
        Veriffica is a checklist designed to help people without experience in buying a good used car. It lets you check
        all the most important elements of the vehicle before deciding to buy it.
      </p>
      <p>
        <strong>
          This list is only an auxiliary tool. It does not guarantee that the car you are buying is in good technical
          condition
        </strong>{" "}
        — but it is a good starting point for assessing the car and can save you money at a service station.
      </p>

      <div>
        <p className="mb-1">The checklist has two sections:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Section 1 (Parts 1–4)</strong> — vehicle condition assessment: helps you judge the overall condition
            of the car.
          </li>
          <li>
            <strong>Section 2 (Part 5)</strong> — chassis numbers and vehicle documents: shows which documents to take
            into account when buying.
          </li>
        </ul>
      </div>

      <p>
        In Section 1 the car&rsquo;s elements and reactions are listed one by one, in the order you should pay attention
        to them during the inspection. Under each element, choose <strong>Yes</strong>, <strong>No</strong>, or{" "}
        <strong>I can&rsquo;t check</strong> after evaluating it:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Yes</strong> — &ldquo;yes, it occurs&rdquo;: the described condition, element, or reaction is present.
        </li>
        <li>
          <strong>No</strong> — &ldquo;no, it doesn&rsquo;t occur&rdquo;: the described condition is not present.
        </li>
      </ul>

      <p className="rounded-md border border-white/10 bg-white/5 p-3">
        <strong>Example:</strong> if you notice molding curves and body lines, then in the &ldquo;Body&rdquo; category,
        under &ldquo;Repair / wear traces&rdquo;, in the &ldquo;Molding curves and body lines&rdquo; sub-item, select{" "}
        <strong>Yes</strong>.
      </p>

      <p>
        More <strong>Yes</strong> answers in Section 1 mean a technically inferior car. More <strong>Yes</strong>{" "}
        answers in Section 2 mean a more reliable seller and a more reliable car.
      </p>
      <p>Most questions have an &ldquo;i&rdquo; button that shows a short description of the fault.</p>
      <p>We wish you a successful car inspection.</p>
    </div>
  );
}
