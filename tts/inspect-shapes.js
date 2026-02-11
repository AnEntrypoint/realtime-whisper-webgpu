// ONNX Model Shape Inspector
// This module inspects the ONNX model and returns the correct shapes for all state inputs

export async function inspectModelShapes(modelPath, ortModule) {
    const ort = ortModule.default || ortModule;

    const opts = {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
    };

    console.log('Creating session for model inspection...');
    const session = await ort.InferenceSession.create(modelPath, opts);

    const shapeMap = {};
    const stateInputs = [];

    console.log('\n=== MODEL INSPECTION RESULTS ===\n');
    console.log('Input Names:');

    session.inputNames.forEach(name => {
        const metadata = session.inputMetadata[name];
        const dims = Array.from(metadata.dims);
        console.log(`  ${name}: shape = [${dims.join(', ')}], rank = ${dims.length}`);

        if (name.startsWith('state_')) {
            stateInputs.push(name);
            shapeMap[name] = dims;
        }
    });

    console.log('\nState Inputs Found:');
    stateInputs.forEach(name => {
        const shape = shapeMap[name];
        console.log(`  ${name}: [${shape.join(', ')}]`);
    });

    console.log('\nOutput Names:');
    session.outputNames.forEach(name => {
        const metadata = session.outputMetadata[name];
        const dims = Array.from(metadata.dims);
        console.log(`  ${name}: shape = [${dims.join(', ')}], rank = ${dims.length}`);
    });

    return {
        shapeMap,
        stateInputs,
        allInputNames: session.inputNames,
        allOutputNames: session.outputNames
    };
}

// Generate code snippet for fixing tts-client.js
export function generateShapeMapCode(shapeMap) {
    let code = '// Auto-generated shape map from model inspection\n';
    code += 'const stateShapeMap = {\n';

    Object.entries(shapeMap).forEach(([name, dims]) => {
        code += `    "${name}": [${dims.join(', ')}],\n`;
    });

    code += '};\n\n';
    code += 'for (const stateName of stateInputNames) {\n';
    code += '    const stateShape = stateShapeMap[stateName];\n';
    code += '    const stateSize = stateShape.reduce((a, b) => a * b, 1);\n';
    code += '    flowState[stateName] = new ort.Tensor("float32", new Float32Array(stateSize).fill(0), stateShape);\n';
    code += '}\n';

    return code;
}
