import { sameAbsProgram } from './abs-program-state';

describe('ABS viewport-neutral program comparison', () => {
  const document = () => ({ pages: [{ id: 'main', content: { value: 1 }, viewState: { scale: 1, scrollX: 10, scrollY: 20 } }], sharedModel: {} });
  it('ignores only known numeric viewport values without mutating either document', () => {
    const a = document(), b = document(); b.pages[0].viewState = { scale: 0.5, scrollX: 20, scrollY: 30 };
    expect(sameAbsProgram(a, b)).toBeTrue(); expect(a.pages[0].viewState.scale).toBe(1);
    delete b.pages[0].viewState; expect(sameAbsProgram(a, b)).toBeTrue();
  });
  it('keeps unknown view state, page content, shared models and invalid values significant', () => {
    for (const change of [b => b.pages[0].viewState.extension = 1, b => b.pages[0].content.value++,
      b => b.sharedModel.reference = 'id', b => b.pages[0].viewState.scale = 'invalid']) {
      const b = document(); change(b); expect(sameAbsProgram(document(), b)).toBeFalse();
    }
  });
});
