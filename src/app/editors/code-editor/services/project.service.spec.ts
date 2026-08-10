import { ActionService } from '../../../services/action.service';
import { _ProjectService } from './project.service';

describe('code editor project actions', () => {
  it('saves dirty files when the global project-save action is dispatched', async () => {
    const actions = new ActionService();
    const service = new _ProjectService(actions);
    const saved: number[] = [];
    service.init();
    service.registerCodeEditor({
      openedFiles: [
        { path: 'main.py', title: 'main.py', content: '', isDirty: true },
        { path: 'README.md', title: 'README.md', content: '', isDirty: false },
      ],
      saveFile: async index => { saved.push(index); },
      runProject: async () => ({ state: 'done', text: 'Python script started' }),
    });

    const feedback = await actions.dispatchWithFeedback('project-save', { path: 'demo' }).toPromise();

    expect(feedback?.success).toBeTrue();
    expect(saved).toEqual([0]);
  });

  it('runs the active Python project for the global compile-begin action', async () => {
    const actions = new ActionService();
    const service = new _ProjectService(actions);
    service.init();
    service.registerCodeEditor({
      openedFiles: [],
      saveFile: async () => undefined,
      runProject: async () => ({ state: 'done', text: 'Python script started' }),
    });

    const feedback = await actions.dispatchWithFeedback('compile-begin', {}).toPromise();

    expect(feedback?.data).toEqual({
      success: true,
      result: { state: 'done', text: 'Python script started' },
    });
  });
});
