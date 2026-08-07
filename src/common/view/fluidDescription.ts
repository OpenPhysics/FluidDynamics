/**
 * fluidDescription.ts
 *
 * A live, localized sentence describing what the flow is currently doing.
 *
 * A screen-reader user cannot see the dye, so this is the whole simulation for
 * them: what the fluid is flowing past, how fast, and — the part that matters —
 * which regime the Reynolds number puts the wake in. It is used both as the
 * fluid field's accessible description and as the screen summaries' live
 * "current details" paragraph, so the two never disagree.
 */

import { DerivedProperty, type TReadOnlyProperty } from "scenerystack/axon";
import { StringUtils } from "scenerystack/phetcommon";
import { StringManager } from "../../i18n/StringManager.js";
import type { FluidModel } from "../model/FluidModel.js";
import type { ObstacleShape } from "../model/ObstacleShape.js";
import { createRegimeStringProperty, formatReynolds } from "./FlowReadoutNode.js";

/**
 * Builds the description Property. The caller owns it and must dispose it.
 */
export function createFluidDescriptionProperty(model: FluidModel): TReadOnlyProperty<string> {
  const strings = StringManager.getInstance().getFluidStrings();
  const a11y = StringManager.getInstance().getFluidA11yStrings();
  const regimeStringProperty = createRegimeStringProperty(model.flowRegimeProperty);

  // Written out rather than looked up by key, so a new shape fails to compile
  // until it has a name to be described by.
  const shapeLabels: Record<ObstacleShape, TReadOnlyProperty<string>> = {
    none: strings.shapes.noneStringProperty,
    cylinder: strings.shapes.cylinderStringProperty,
    plate: strings.shapes.plateStringProperty,
    airfoil: strings.shapes.airfoilStringProperty,
  };

  const descriptionProperty = DerivedProperty.deriveAny(
    [
      model.obstacleShapeProperty,
      model.flowSpeedProperty,
      model.reynoldsNumberProperty,
      regimeStringProperty,
      a11y.fieldDescriptionPatternStringProperty,
      strings.shapes.noneStringProperty,
      strings.shapes.cylinderStringProperty,
      strings.shapes.plateStringProperty,
      strings.shapes.airfoilStringProperty,
    ],
    () =>
      StringUtils.fillIn(a11y.fieldDescriptionPatternStringProperty.value, {
        shape: shapeLabels[model.obstacleShapeProperty.value].value.toLocaleLowerCase(),
        speed: model.flowSpeedProperty.value.toFixed(2),
        reynolds: formatReynolds(model.reynoldsNumberProperty.value),
        regime: regimeStringProperty.value.toLocaleLowerCase(),
      }),
  );

  // The regime Property is an implementation detail of this one, so it is
  // disposed with it rather than being handed back for the caller to track.
  descriptionProperty.disposeEmitter.addListener(() => regimeStringProperty.dispose());

  return descriptionProperty;
}
