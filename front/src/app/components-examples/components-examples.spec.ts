import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComponentsExamples } from './components-examples';

describe('ComponentsExamples', () => {
  let component: ComponentsExamples;
  let fixture: ComponentFixture<ComponentsExamples>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComponentsExamples],
    }).compileComponents();

    fixture = TestBed.createComponent(ComponentsExamples);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
