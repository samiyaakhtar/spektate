
import Table = require('cli-table');
import * as fs from 'fs';
import * as os from 'os';
import { config } from '../config';
import Deployment from '../models/Deployment';
import AzureDevOpsPipeline from '../models/pipeline/AzureDevOpsPipeline';
import { Author } from '../models/repository/Author';
import { GitHub } from '../models/repository/GitHub';
import { Repository } from '../models/repository/Repository';

const hldPipeline = new AzureDevOpsPipeline(config.AZURE_ORG, config.AZURE_PROJECT, config.DOCKER_PIPELINE_ID, true);
const clusterPipeline = new AzureDevOpsPipeline(config.AZURE_ORG, config.AZURE_PROJECT, config.HLD_PIPELINE_ID);
const srcPipeline = new AzureDevOpsPipeline(config.AZURE_ORG, config.AZURE_PROJECT, config.SRC_PIPELINE_ID);
const fileLocation = os.homedir() + "/.ContainerJourney";

export class AccessHelper {
    public static getAuthorForCommitOrBuild(commitId?: string, buildId?: string, callback?: ((author?: Author) => void)) {
        Deployment.getDeploymentsBasedOnFilters(config.STORAGE_PARTITION_KEY, srcPipeline, hldPipeline, clusterPipeline, undefined, undefined, buildId, commitId, (deployments: Deployment[]) => {
            if (deployments.length > 0 && callback) {
                deployments[0].fetchAuthor(callback);
            } else if(callback) {
                callback(undefined);
            }
        });
    }
    public static verifyAppConfiguration = (callback?: () => void) => {
        if (config.STORAGE_TABLE_NAME === "" || config.STORAGE_PARTITION_KEY === "" || config.STORAGE_ACCOUNT_NAME === "" || config.STORAGE_ACCOUNT_KEY === "" || config.SRC_PIPELINE_ID === 0 || config.HLD_PIPELINE_ID === 0 || config.GITHUB_MANIFEST_USERNAME === "" || config.GITHUB_MANIFEST === "" || config.DOCKER_PIPELINE_ID === undefined || config.AZURE_PROJECT === "" || config.AZURE_ORG === "") {
            AccessHelper.configureAppFromFile(callback);
            return false;
        }

        return true;
    }

    public static configureAppFromFile = (callback?: () => void) => {
        fs.readFile(fileLocation, (error, data) => {
            if (error) {
                console.log(error);
            }
            const array = data.toString().split('\n');
            array.forEach((row: string) => {
                const key = row.split(/=(.+)/)[0];
                const value = row.split(/=(.+)/)[1];
                config[key] = value;
            });
            if (callback) {
                callback();
            }
        });
    }

    public static writeConfigToFile = (configMap: any) => {
        let data = "";
        Object.keys(configMap).forEach((key) => {
            data += "\n" + key + "=" + configMap[key];
        })
        fs.writeFile(fileLocation, data, (error: any) => {
            if (error) {
                console.log(error);
            }
        });
    }

    public static getClusterSync = (callback?: (syncCommit: string) => void): void => {
        const manifestRepo: Repository = new GitHub(config.GITHUB_MANIFEST_USERNAME, config.GITHUB_MANIFEST);
        manifestRepo.getManifestSyncState((commit) => {
            if (callback) {
                callback(commit);
            }
        });
    }

    // TODO: Once the bug with release API is fixed (regarding returning only top 50 rows),
    // improve the below and move it into models
    public static getLogs = (buildId: string, releaseId: string) => {
        if (buildId !== undefined && buildId !== "") {
            const p1 = srcPipeline.getListOfBuilds();
            const p2 = clusterPipeline.getListOfBuilds();
            Promise.all([p1, p2]).then(() => {
                if (buildId in srcPipeline.builds) {
                    console.log("Navigate to: " + srcPipeline.builds[buildId].URL);
                } else if (buildId in clusterPipeline.builds) {
                    console.log("Navigate to: " + clusterPipeline.builds[buildId].URL);
                } else {
                    console.log("Unable to find build for " + buildId);
                }
            });
        } else if (releaseId !== undefined && releaseId !== "") {
            hldPipeline.getListOfReleases().then(() => {
                if (releaseId in hldPipeline.releases) {
                    console.log("Navigate to: " + hldPipeline.releases[releaseId].URL);
                } else {
                    console.log("Unable to find release for " + releaseId);
                }
            });
        } else {
            console.log("One of build-id or release-id need to be specified.");
        }
    }

    public static getDeployments = (environment?: string, imageTag?: string, p1Id?: string, commitId?: string) => {
        Deployment.getDeploymentsBasedOnFilters(config.STORAGE_PARTITION_KEY, srcPipeline, hldPipeline, clusterPipeline, environment, imageTag, p1Id, commitId, (deployments: Deployment[]) => {

            if (deployments.length > 0) {
                let row = [];
                row.push("Start Time");
                row.push("P1");
                row.push("Result");
                row.push("Commit");
                row.push("P2");
                row.push("Result");
                row.push("Hld Commit");
                row.push("Env");
                row.push("Image Tag");
                row.push("P3");
                row.push("Result");
                row.push("Manifest Commit");
                row.push("End Time");
                const table = new Table({head: row});
                deployments.forEach((deployment) => {
                    row = [];
                    row.push(deployment.srcToDockerBuild ? deployment.srcToDockerBuild.startTime.toLocaleString() : "");
                    row.push(deployment.srcToDockerBuild ? deployment.srcToDockerBuild.id : "");
                    row.push(deployment.srcToDockerBuild ? AccessHelper.getStatus(deployment.srcToDockerBuild.result) : "");
                    row.push(deployment.commitId);
                    row.push(deployment.dockerToHldRelease ? deployment.dockerToHldRelease.id : "");
                    row.push(deployment.dockerToHldRelease ? AccessHelper.getStatus(deployment.dockerToHldRelease.status) : "");
                    row.push(deployment.hldCommitId);
                    row.push(deployment.environment);
                    row.push(deployment.imageTag);
                    row.push(deployment.hldToManifestBuild ? deployment.hldToManifestBuild.id : "");
                    row.push(deployment.hldToManifestBuild ? AccessHelper.getStatus(deployment.hldToManifestBuild.result) : "");
                    row.push(deployment.manifestCommitId);
                    row.push(deployment.hldToManifestBuild ? deployment.hldToManifestBuild.finishTime.toLocaleString() : "");
                    table.push(row);
                });

                console.log(table.toString());
            } else {
                console.log("No deployments found for specified filters.");
            }
        });
    }

    public static getStatus = ( status: string) => {
        if (status === "succeeded") {
            return '\u2713';
        }
        return '\u0445';
    }
}
