import { TSpecl, IExtensionConstructor, TResult, TWorld, TProtoOptions } from './defs';
export declare function run({ specl, base, world, addSteppers, featureFilter, protoOptions: protoOptions, }: {
    specl: TSpecl;
    world: TWorld;
    base: string;
    addSteppers?: IExtensionConstructor[];
    featureFilter?: string;
    protoOptions?: TProtoOptions;
}): Promise<{
    result: TResult;
}>;
//# sourceMappingURL=run.d.ts.map