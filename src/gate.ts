import type { FailOn, Finding } from './report/types.js';

export const FAIL_ON_VALUES: readonly FailOn[] = ['none', 'serious-security', 'limit-crossed', 'any'];

export function isFailOn(v: string): v is FailOn {
  return (FAIL_ON_VALUES as readonly string[]).includes(v);
}

/** Spec §6: none → pass; serious-security → any serious security-new/grew; limit-crossed → a function-regression with crossed metrics or an approximate net increase; any → any finding that is not info/improved (a hotspot touch alone fails). */
export function gate(findings: Finding[], failOn: FailOn): 'pass' | 'fail' {
  switch (failOn) {
    case 'none':
      return 'pass';
    case 'serious-security':
      return findings.some((f) => (f.kind === 'security-new' || f.kind === 'security-grew') && f.severity === 'serious')
        ? 'fail'
        : 'pass';
    case 'limit-crossed':
      return findings.some(
        (f) =>
          f.kind === 'function-regression' &&
          ((Array.isArray(f.data['metrics']) && f.data['metrics'].length > 0) || f.data['approximate'] === true),
      )
        ? 'fail'
        : 'pass';
    case 'any':
      return findings.some((f) => f.severity !== 'info' && f.severity !== 'improved') ? 'fail' : 'pass';
    default: {
      const bad: never = failOn;
      throw new Error(`unknown fail-on policy ${String(bad)}`);
    }
  }
}
