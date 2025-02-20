
let compileOpts = {
    fqbn: 'arduino:avr:uno', // 
    projectPath: 'C:\\Users\\coloz\\Desktop\\sketch_feb20a',
    ShowProperties: showProperties !== arguments.ShowPropertiesDisabled,
    Preprocess: preprocess,
    BuildCachePath: buildCachePath,
    BuildPath: buildPath,
    BuildProperties: buildProperties,
    Warnings: warnings,
    Verbose: verbose,
    Quiet: quiet,
    ExportBinaries: exportBinaries, // 在Go中传递指针，在JS中直接传递变量引用就可
    ExportDir: exportDir,
    Libraries: libraries,
    OptimizeForDebug: optimizeForDebug,
    Clean: clean,
    CreateCompilationDatabaseOnly: compilationDatabaseOnly,
    SourceOverride: overrides,
    Library: libraryAbs,
    KeysKeychain: keysKeychain,
    SignKey: signKey,
    EncryptKey: encryptKey,
    SkipLibrariesDiscovery: skipLibrariesDiscovery,
    DoNotExpandBuildProperties: showProperties === arguments.ShowPropertiesUnexpanded,
    Jobs: jobs,
};

main();

async function main() {



}

function getArgv(name) {
    return process.argv[process.argv.indexOf(name) + 1]
}