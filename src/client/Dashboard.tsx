import { Ago } from "azure-devops-ui/Ago";
import { Card } from "azure-devops-ui/Card";
import { ObservableValue } from "azure-devops-ui/Core/Observable";
import { Duration } from "azure-devops-ui/Duration";
import { Icon, IIconProps } from "azure-devops-ui/Icon";
import { Link } from "azure-devops-ui/Link";
import { Status, Statuses, StatusSize } from "azure-devops-ui/Status";
import {
  ColumnFill,
  ITableColumn,
  SimpleTableCell,
  Table,
  TwoLineTableCell
} from "azure-devops-ui/Table";
import { Tooltip } from "azure-devops-ui/TooltipEx";
import { Filter } from "azure-devops-ui/Utilities/Filter";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { VssPersona } from "azure-devops-ui/VssPersona";
import * as querystring from "querystring";
import * as React from "react";
import { HttpHelper } from "spektate/lib/HttpHelper";
import {
  endTime,
  getRepositoryFromURL,
  IDeployment,
  status
} from "spektate/lib/IDeployment";
import { IAuthor } from "spektate/lib/repository/Author";
import { IAzureDevOpsRepo } from "spektate/lib/repository/IAzureDevOpsRepo";
import { IGitHub } from "spektate/lib/repository/IGitHub";
import { IPullRequest } from "spektate/lib/repository/IPullRequest";
import { ITag } from "spektate/lib/repository/Tag";
import "./css/dashboard.css";
import {
  IDashboardFilterState,
  IDashboardState,
  IDeploymentField,
  IStatusIndicatorData
} from "./Dashboard.types";
import { DeploymentFilter } from "./DeploymentFilter";

const REFRESH_INTERVAL = 30000;
const iconColors = {
  blue: "#0a78d4",
  gray: "#3b606d",
  green: "#2aa05b",
  purple: "#5b50e2",
  red: "#c8281f",
  yellow: "#e08a00"
};
class Dashboard<Props> extends React.Component<Props, IDashboardState> {
  private interval: NodeJS.Timeout;
  private filter: Filter = new Filter();
  private filterState: IDashboardFilterState = {
    defaultApplied: false
  };
  private clusterSyncAvailable: boolean = false;
  private releasesUrl?: string;

  constructor(props: Props) {
    super(props);
    this.state = {
      authors: {},
      deployments: [],
      filteredDeployments: [],
      prs: {}
    };
  }

  public componentDidMount() {
    this.interval = setInterval(this.updateDeployments, REFRESH_INTERVAL);
    this.updateDeployments();
  }

  public componentWillUnmount() {
    clearInterval(this.interval);
  }

  public render() {
    return (
      <div className="App">
        <header className="App-header">
          <h1 className="App-title">Spektate</h1>
          <div className="App-last-update">
            <div>Last updated at {new Date().toLocaleTimeString()}</div>
          </div>
        </header>
        <DeploymentFilter
          filter={this.filter}
          onFiltered={this.onDashboardFiltered}
          listOfAuthors={this.getListOfAuthors()}
          listOfEnvironments={this.getListOfEnvironments()}
          listOfServices={this.getListOfServices()}
        />
        {this.state.error ? (
          <Card>{this.state.error.toString()}</Card>
        ) : (
          this.renderPrototypeTable()
        )}
      </div>
    );
  }

  private updateDeployments = async () => {
    try {
      const deps = await HttpHelper.httpGet<any>("/api/deployments");
      if (!deps.data) {
        console.log(deps.request.response);
        throw new Error(deps.request.response);
      }
      const ideps: IDeployment[] = deps.data as IDeployment[];
      this.processQueryParams();
      const deployments: IDeployment[] = ideps.map(dep => {
        return {
          author: dep.author,
          commitId: dep.commitId,
          deploymentId: dep.deploymentId,
          dockerToHldRelease: dep.dockerToHldRelease,
          dockerToHldReleaseStage: dep.dockerToHldReleaseStage,
          environment: dep.environment,
          hldCommitId: dep.hldCommitId,
          hldRepo: dep.hldRepo,
          hldToManifestBuild: dep.hldToManifestBuild,
          imageTag: dep.imageTag,
          manifestCommitId: dep.manifestCommitId,
          manifestRepo: dep.manifestRepo,
          pr: dep.pr,
          service: dep.service,
          sourceRepo: dep.sourceRepo,
          srcToDockerBuild: dep.srcToDockerBuild,
          timeStamp: dep.timeStamp
        };
      });

      if (deployments.length === 0) {
        throw new Error("No deployments were found for this configuration.");
      }

      this.setState({
        deployments,
        error: undefined,
        filteredDeployments: this.state.deployments
      });
      this.processQueryParams();
      this.updateFilteredDeployments();
      this.getAuthors();
      this.getPRs();
      if (!this.filterState.defaultApplied) {
        this.filter.setFilterItemState("authorFilter", {
          value: this.filterState.currentlySelectedAuthors
        });
        this.filter.setFilterItemState("serviceFilter", {
          value: this.filterState.currentlySelectedServices
        });
        this.filter.setFilterItemState("envFilter", {
          value: this.filterState.currentlySelectedEnvs
        });
        this.filter.setFilterItemState("keywordFilter", {
          value: this.filterState.currentlySelectedKeyword
        });
      }
      HttpHelper.httpGet("/api/clustersync").then((syncData: any) => {
        if (syncData.data && syncData.data.tags && syncData.data.releasesURL) {
          this.setState({ manifestSyncStatuses: syncData.data.tags as ITag[] });
          this.releasesUrl = syncData.data.releasesURL;
        }
      });
    } catch (e) {
      console.log(e);
      this.setState({
        error: e
      });
    }
  };

  private renderPrototypeTable = () => {
    const columns: Array<ITableColumn<IDeploymentField>> = [
      {
        id: "status",
        name: "State",
        renderCell: this.renderDeploymentStatus,
        width: new ObservableValue(70)
      },
      {
        id: "service",
        name: "Service",
        renderCell: this.renderSimpleText,
        width: new ObservableValue(180)
      },
      {
        id: "environment",
        name: "Ring",
        renderCell: this.renderSimpleText,
        width: new ObservableValue(220)
      },
      {
        id: "authorName",
        name: "Author",
        renderCell: this.renderAuthor,
        width: new ObservableValue(200)
      },
      {
        id: "srcPipelineId",
        name: "SRC to ACR",
        renderCell: this.renderSrcBuild,
        width: new ObservableValue(200)
      },
      {
        id: "dockerPipelineId",
        name: "ACR to HLD",
        renderCell: this.renderDockerRelease,
        width: new ObservableValue(250)
      },
      {
        id: "pr",
        name: "Approval Pull Request",
        renderCell: this.renderPR,
        width: new ObservableValue(250)
      },
      {
        id: "mergedByName",
        name: "Merged By",
        renderCell: this.renderMergedBy,
        width: new ObservableValue(200)
      },
      {
        id: "hldPipelineId",
        name: "HLD to Manifest",
        renderCell: this.renderHldBuild,
        width: new ObservableValue(200)
      },
      {
        id: "deployedAt",
        name: "Last Updated",
        renderCell: this.renderTime,
        width: new ObservableValue(120)
      }
    ];

    // Display the cluster column only if there is information to show in the table
    if (this.clusterSyncAvailable) {
      columns.push({
        id: "clusterName",
        name: "Synced Cluster",
        renderCell: this.renderClusters,
        width: new ObservableValue(200)
      });
    }
    columns.push(ColumnFill);
    let rows: IDeploymentField[] = [];
    try {
      if (this.state.filteredDeployments.length === 0) {
        rows = new Array(15).fill(new ObservableValue(undefined));
      } else {
        rows = this.state.filteredDeployments.map(deployment => {
          return this.getDeploymentToDisplay(deployment);
        });
      }
    } catch (err) {
      console.error(err);
    }
    return (
      <div className="PrototypeTable">
        <Table
          columns={columns}
          pageSize={rows.length}
          role="table"
          itemProvider={new ArrayItemProvider<IDeploymentField>(rows)}
          showLines={true}
        />
      </div>
    );
  };

  private getDeploymentToDisplay = (
    deployment: IDeployment
  ): IDeploymentField => {
    const author = this.getAuthor(deployment);
    const pr = this.getPR(deployment);
    const tags = this.getClusterSyncStatusForDeployment(deployment);
    const clusters: string[] = tags ? tags.map(itag => itag.name) : [];
    const statusStr = status(deployment);
    const endtime = endTime(deployment);
    return {
      deploymentId: deployment.deploymentId,
      service: deployment.service !== "" ? deployment.service : "-",
      startTime: deployment.srcToDockerBuild
        ? deployment.srcToDockerBuild.startTime
        : new Date(),
      // tslint:disable-next-line: object-literal-sort-keys
      imageTag: deployment.imageTag,
      srcCommitId: deployment.commitId,
      srcBranchName: deployment.srcToDockerBuild
        ? deployment.srcToDockerBuild.sourceBranch.replace("refs/heads/", "")
        : "-",
      srcCommitURL: deployment.srcToDockerBuild
        ? deployment.srcToDockerBuild.sourceVersionURL
        : "",
      srcPipelineId: deployment.srcToDockerBuild
        ? deployment.srcToDockerBuild.buildNumber
        : "",
      srcPipelineURL: deployment.srcToDockerBuild
        ? deployment.srcToDockerBuild.URL
        : "",
      srcPipelineResult: deployment.srcToDockerBuild
        ? deployment.srcToDockerBuild.result
        : "-",
      dockerPipelineId: deployment.dockerToHldRelease
        ? deployment.dockerToHldRelease.releaseName
        : deployment.dockerToHldReleaseStage
        ? deployment.dockerToHldReleaseStage.buildNumber
        : "",
      dockerPipelineURL: deployment.dockerToHldRelease
        ? deployment.dockerToHldRelease.URL
        : deployment.dockerToHldReleaseStage
        ? deployment.dockerToHldReleaseStage.URL
        : "",
      environment:
        deployment.environment !== ""
          ? deployment.environment.toUpperCase()
          : "-",
      dockerPipelineResult: deployment.dockerToHldRelease
        ? deployment.dockerToHldRelease.status
        : deployment.dockerToHldReleaseStage
        ? deployment.dockerToHldReleaseStage.result
        : "",
      hldCommitId: deployment.hldCommitId !== "" ? deployment.hldCommitId : "-",
      hldCommitURL: deployment.hldToManifestBuild
        ? deployment.hldToManifestBuild.sourceVersionURL
        : "",
      hldPipelineId: deployment.hldToManifestBuild
        ? deployment.hldToManifestBuild.buildNumber
        : "",
      hldPipelineResult: deployment.hldToManifestBuild
        ? deployment.hldToManifestBuild.result
        : "-",
      hldPipelineURL: deployment.hldToManifestBuild
        ? deployment.hldToManifestBuild.URL
        : "",
      duration: deployment.duration ? deployment.duration + " mins" : "",
      authorName: author ? author.name : "",
      authorURL: author ? author.imageUrl : "",
      status: pr && !pr.mergedBy ? "waiting" : statusStr,
      clusters,
      endTime: endtime,
      manifestCommitId: deployment.manifestCommitId,
      pr: pr ? pr.id : undefined,
      prURL: pr ? pr.url : undefined,
      prSourceBranch: pr ? pr.sourceBranch : undefined,
      mergedByName: pr
        ? pr.mergedBy
          ? pr.mergedBy.name
          : undefined
        : undefined,
      mergedByImageURL: pr
        ? pr.mergedBy
          ? pr.mergedBy.imageUrl
          : undefined
        : undefined
    };
  };

  private onDashboardFiltered = (filterData: Filter) => {
    this.filter = filterData;
    this.updateFilteredDeployments();
  };

  private updateFilteredDeployments = () => {
    if (this.filter) {
      const keywordFilter: string | undefined = this.filter.getFilterItemValue(
        "keywordFilter"
      );

      const serviceFilters: Set<string> = new Set(
        this.filter.getFilterItemValue("serviceFilter")
      );
      const authorFilters: Set<string> = new Set(
        this.filter.getFilterItemValue("authorFilter")
      );
      const envFilters: Set<string> = new Set(
        this.filter.getFilterItemValue("envFilter")
      );

      this.updateQueryString(
        keywordFilter,
        serviceFilters,
        authorFilters,
        envFilters
      );
      this.filterDeployments(
        keywordFilter,
        serviceFilters,
        authorFilters,
        envFilters
      );
    }
  };

  private updateQueryString(
    keywordFilter: string | undefined,
    serviceFilters: Set<string>,
    authorFilters: Set<string>,
    envFilters: Set<string>
  ) {
    const query: any = {};

    if (keywordFilter && keywordFilter.length > 0) {
      query.keyword = keywordFilter;
    }

    if (serviceFilters.size > 0) {
      query.service = Array.from(serviceFilters);
    }

    if (authorFilters.size > 0) {
      query.author = Array.from(authorFilters);
    }

    if (envFilters.size > 0) {
      query.env = Array.from(envFilters);
    }

    if (history.replaceState) {
      const newurl =
        window.location.protocol +
        "//" +
        window.location.host +
        window.location.pathname +
        "?" +
        querystring.encode(query);

      window.history.replaceState({ path: newurl }, "", newurl);
    } else {
      window.location.search = querystring.encode(query);
    }
  }

  private filterDeployments(
    keywordFilter: string | undefined,
    serviceFilters: Set<string>,
    authorFilters: Set<string>,
    envFilters: Set<string>
  ) {
    let filteredDeployments: IDeployment[] = this.state.deployments;

    if (keywordFilter && keywordFilter.length > 0) {
      filteredDeployments = filteredDeployments.filter(deployment => {
        return JSON.stringify(deployment).includes(keywordFilter);
      });
    }

    if (serviceFilters.size > 0) {
      filteredDeployments = filteredDeployments.filter(deployment => {
        return serviceFilters.has(deployment.service);
      });
    }

    if (authorFilters.size > 0) {
      filteredDeployments = filteredDeployments.filter(deployment => {
        if (deployment.author) {
          return authorFilters.has(deployment.author!.name);
        }
        return false;
      });
    }

    if (envFilters.size > 0) {
      filteredDeployments = filteredDeployments.filter(deployment => {
        return envFilters.has(deployment.environment);
      });
    }

    this.setState({ filteredDeployments });
  }

  private processQueryParams = () => {
    if (window.location.search === "") {
      return;
    }

    const filters = querystring.decode(window.location.search.replace("?", ""));
    let keywordFilter: undefined | string;
    const authorFilters: Set<string> = this.getFilterSet("author");
    const serviceFilters: Set<string> = this.getFilterSet("service");
    const envFilters: Set<string> = this.getFilterSet("env");

    if (filters.keyword && filters.keyword !== "") {
      keywordFilter = filters.keyword.toString();
    }

    // this.filterState = {
    //   currentlySelectedAuthors: Array.from(authorFilters),
    //   currentlySelectedEnvs: Array.from(envFilters),
    //   currentlySelectedKeyword: keywordFilter,
    //   currentlySelectedServices: Array.from(serviceFilters),
    //   defaultApplied: false
    // };

    this.updateQueryString(
      keywordFilter,
      serviceFilters,
      authorFilters,
      envFilters
    );
    this.filterDeployments(
      keywordFilter,
      serviceFilters,
      authorFilters,
      envFilters
    );
  };

  private getFilterSet = (queryParam: string): Set<string> => {
    const filters = querystring.decode(window.location.search.replace("?", ""));
    let filterSet: Set<string> = new Set<string>();
    if (filters[queryParam] && filters[queryParam].length > 0) {
      if (typeof filters[queryParam] === "string") {
        filterSet.add(filters[queryParam] as string);
      } else {
        filterSet = new Set(filters[queryParam]);
      }
    }
    return filterSet;
  };

  private getListOfEnvironments = (): string[] => {
    const envs: { [id: string]: boolean } = {};
    this.state.deployments.forEach((deployment: IDeployment) => {
      if (deployment.environment !== "" && !(deployment.environment in envs)) {
        envs[deployment.environment] = true;
      }
    });
    return Array.from(Object.keys(envs));
  };

  private getListOfServices = (): string[] => {
    const services: { [id: string]: boolean } = {};
    this.state.deployments.forEach((deployment: IDeployment) => {
      if (deployment.service !== "" && !(deployment.service in services)) {
        services[deployment.service] = true;
      }
    });
    return Array.from(Object.keys(services));
  };

  private getListOfAuthors = (): Set<string> => {
    return new Set(
      Array.from(Object.values(this.state.authors)).map(author => author.name)
    );
  };

  private getClusterSyncStatusForDeployment = (
    deployment: IDeployment
  ): ITag[] | undefined => {
    const clusterSyncs: ITag[] = [];
    if (this.state.manifestSyncStatuses) {
      this.state.manifestSyncStatuses.forEach((tag: ITag) => {
        if (deployment.manifestCommitId === tag.commit) {
          this.clusterSyncAvailable = true;
          clusterSyncs.push(tag);
        }
      });
    }
    return clusterSyncs;
  };

  private renderSimpleText = (
    rowIndex: number,
    columnIndex: number,
    tableColumn: ITableColumn<IDeploymentField>,
    tableItem: IDeploymentField
  ): JSX.Element => {
    if (!tableItem[tableColumn.id]) {
      return (
        <SimpleTableCell key={"col-" + columnIndex} columnIndex={columnIndex} />
      );
    }
    return (
      <SimpleTableCell
        columnIndex={columnIndex}
        tableColumn={tableColumn}
        key={"col-" + columnIndex}
        contentClassName="fontSizeM font-size-m scroll-hidden"
      >
        <div className="flex-row scroll-hidden">
          <Tooltip overflowOnly={true}>
            <span className="text-ellipsis">{tableItem[tableColumn.id]}</span>
          </Tooltip>
        </div>
      </SimpleTableCell>
    );
  };

  private renderPersona = (
    rowIndex: number,
    columnIndex: number,
    tableColumn: ITableColumn<IDeploymentField>,
    tableItem: IDeploymentField,
    name: string,
    imageUrl?: string
  ): JSX.Element => {
    if (!tableItem[tableColumn.id]) {
      return (
        <SimpleTableCell key={"col-" + columnIndex} columnIndex={columnIndex} />
      );
    }
    return (
      <SimpleTableCell
        columnIndex={columnIndex}
        tableColumn={tableColumn}
        key={"col-" + columnIndex}
        contentClassName="font-size-m text-ellipsis bolt-table-link bolt-table-inline-link"
      >
        <VssPersona displayName={name} imageUrl={imageUrl} />
        <div>&nbsp;&nbsp;&nbsp;</div>
        <div className="flex-row scroll-hidden">
          <Tooltip overflowOnly={true}>
            <span className="text-ellipsis">{tableItem[tableColumn.id]}</span>
          </Tooltip>
        </div>
      </SimpleTableCell>
    );
  };

  private renderTime = (
    rowIndex: number,
    columnIndex: number,
    tableColumn: ITableColumn<IDeploymentField>,
    tableItem: IDeploymentField
  ): JSX.Element => {
    if (!tableItem.startTime || !tableItem.endTime) {
      return (
        <SimpleTableCell key={"col-" + columnIndex} columnIndex={columnIndex} />
      );
    }
    return (
      <TwoLineTableCell
        key={"col-" + columnIndex}
        columnIndex={columnIndex}
        tableColumn={tableColumn}
        line1={this.WithIcon({
          children: <Ago date={new Date(tableItem.endTime!)} />,
          className: "fontSize font-size",
          iconProps: { iconName: "Calendar" }
        })}
        line2={this.WithIcon({
          children: (
            <Duration
              startDate={new Date(tableItem.startTime!)}
              endDate={new Date(tableItem.endTime!)}
            />
          ),
          className: "fontSize font-size bolt-table-two-line-cell-item",
          iconProps: { iconName: "Clock" }
        })}
      />
    );
  };

  private renderSrcBuild = (
    rowIndex: number,
    columnIndex: number,
    tableColumn: ITableColumn<IDeploymentField>,
    tableItem: IDeploymentField
  ): JSX.Element => {
    return this.renderBuild(
      rowIndex,
      columnIndex,
      tableColumn,
      tableItem,
      tableItem.srcPipelineResult,
      tableItem.srcPipelineId,
      tableItem.srcPipelineURL,
      tableItem.srcCommitId,
      tableItem.srcCommitURL,
      "BranchPullRequest"
    );
  };

  private renderHldBuild = (
    rowIndex: number,
    columnIndex: number,
    tableColumn: ITableColumn<IDeploymentField>,
    tableItem: IDeploymentField
  ): JSX.Element => {
    return this.renderBuild(
      rowIndex,
      columnIndex,
      tableColumn,
      tableItem,
      tableItem.hldPipelineResult,
      tableItem.hldPipelineId,
      tableItem.hldPipelineURL,
      tableItem.hldCommitId,
      tableItem.hldCommitURL,
      "BranchPullRequest"
    );
  };

  private renderDockerRelease = (
    rowIndex: number,
    columnIndex: number,
    tableColumn: ITableColumn<IDeploymentField>,
    tableItem: IDeploymentField
  ): JSX.Element => {
    return this.renderBuild(
      rowIndex,
      columnIndex,
      tableColumn,
      tableItem,
      tableItem.dockerPipelineResult,
      tableItem.dockerPipelineId,
      tableItem.dockerPipelineURL,
      tableItem.imageTag,
      "",
      "Product"
    );
  };

  private renderPR = (
    rowIndex: number,
    columnIndex: number,
    tableColumn: ITableColumn<IDeploymentField>,
    tableItem: IDeploymentField
  ): JSX.Element => {
    if (tableItem.pr) {
      return this.renderBuild(
        rowIndex,
        columnIndex,
        tableColumn,
        tableItem,
        tableItem.mergedByName ? "succeeded" : "waiting",
        tableItem.pr.toString(),
        tableItem.prURL,
        tableItem.prSourceBranch,
        "",
        "BranchPullRequest"
      );
    } else {
      return (
        <SimpleTableCell key={"col-" + columnIndex} columnIndex={columnIndex}>
          -
        </SimpleTableCell>
      );
    }
  };

  private renderAuthor = (
    rowIndex: number,
    columnIndex: number,
    tableColumn: ITableColumn<IDeploymentField>,
    tableItem: IDeploymentField
  ): JSX.Element => {
    if (tableItem.authorName && tableItem.authorURL) {
      return this.renderPersona(
        rowIndex,
        columnIndex,
        tableColumn,
        tableItem,
        tableItem.authorName,
        tableItem.authorURL
      );
    }
    return (
      <SimpleTableCell key={"col-" + columnIndex} columnIndex={columnIndex}>
        -
      </SimpleTableCell>
    );
  };

  private renderMergedBy = (
    rowIndex: number,
    columnIndex: number,
    tableColumn: ITableColumn<IDeploymentField>,
    tableItem: IDeploymentField
  ): JSX.Element => {
    if (tableItem.pr && tableItem.mergedByName) {
      return this.renderPersona(
        rowIndex,
        columnIndex,
        tableColumn,
        tableItem,
        tableItem.mergedByName,
        tableItem.mergedByImageURL
      );
    }
    return (
      <SimpleTableCell key={"col-" + columnIndex} columnIndex={columnIndex}>
        -
      </SimpleTableCell>
    );
  };

  private renderClusters = (
    rowIndex: number,
    columnIndex: number,
    tableColumn: ITableColumn<IDeploymentField>,
    tableItem: IDeploymentField
  ): JSX.Element => {
    if (!tableItem.clusters || tableItem.clusters.length === 0) {
      return (
        <SimpleTableCell key={"col-" + columnIndex} columnIndex={columnIndex}>
          -
        </SimpleTableCell>
      );
    }
    const strClusters = tableItem.clusters.join(", ");
    if (tableItem.clusters.length > 2) {
      return (
        <TwoLineTableCell
          className="first-row no-cell-top-border bolt-table-cell-content-with-inline-link no-v-padding"
          key={"col-" + columnIndex}
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          line1={this.renderCluster(
            tableItem.clusters[0] + ", " + tableItem.clusters[1],
            tableItem.clusters!
          )}
          line2={this.renderCluster(
            "and " + (tableItem.clusters.length - 2) + " more...",
            tableItem.clusters!
          )}
        />
      );
    }
    return (
      <SimpleTableCell columnIndex={columnIndex} key={"col-" + columnIndex}>
        {this.renderCluster(strClusters, tableItem.clusters!)}
      </SimpleTableCell>
    );
  };

  private renderCluster = (
    text: string,
    allClusters: string[]
  ): React.ReactNode => {
    return (
      <Tooltip
        // tslint:disable-next-line: jsx-no-lambda
        renderContent={() => this.renderCustomClusterTooltip(allClusters)}
        overflowOnly={false}
      >
        <Link
          className="font-size-m text-ellipsis bolt-table-link bolt-table-inline-link"
          href={this.releasesUrl}
          subtle={true}
        >
          {text}
        </Link>
      </Tooltip>
    );
  };

  private renderCustomClusterTooltip = (clusters: string[]) => {
    const tooltip: React.ReactNode[] = [];
    clusters.forEach(cluster => {
      tooltip.push(
        <span>
          {cluster}
          <br />
        </span>
      );
    });
    return <span>{tooltip}</span>;
  };

  private renderBuild = (
    rowIndex: number,
    columnIndex: number,
    tableColumn: ITableColumn<IDeploymentField>,
    tableItem: IDeploymentField,
    pipelineResult?: string,
    pipelineId?: string,
    pipelineURL?: string,
    commitId?: string,
    commitURL?: string,
    iconName?: string
  ): JSX.Element => {
    if (!pipelineId || !pipelineURL || !commitId) {
      return (
        <SimpleTableCell key={"col-" + columnIndex} columnIndex={columnIndex}>
          -
        </SimpleTableCell>
      );
    }
    const commitCell = this.WithIcon({
      className: "",
      iconProps: { iconName },

      children: <div>{commitId}</div>
    });
    return (
      <TwoLineTableCell
        className="first-row no-cell-top-border bolt-table-cell-content-with-inline-link no-v-padding"
        key={"col-" + columnIndex}
        columnIndex={columnIndex}
        tableColumn={tableColumn}
        iconProps={this.getIcon(pipelineResult)}
        line1={
          <Tooltip text={pipelineId} overflowOnly={true}>
            {pipelineURL && (
              <Link
                className="fontSizeM font-size-m text-ellipsis bolt-table-link bolt-table-inline-link"
                href={pipelineURL}
                // tslint:disable-next-line: jsx-no-lambda
                onClick={() => (parent.window.location.href = pipelineURL)}
              >
                {pipelineId}
              </Link>
            )}
          </Tooltip>
        }
        line2={
          <Tooltip overflowOnly={true}>
            <span className="fontSize font-size secondary-text flex-row flex-center text-ellipsis">
              {commitId && commitURL && commitURL !== "" && (
                <Link
                  className="monospaced-text text-ellipsis flex-row flex-center bolt-table-link bolt-table-inline-link"
                  href={commitURL}
                  // tslint:disable-next-line: jsx-no-lambda
                  onClick={() => (parent.window.location.href = commitURL)}
                >
                  {commitCell}
                </Link>
              )}
              {commitId && commitURL === "" && commitCell}
            </span>
          </Tooltip>
        }
      />
    );
  };

  private renderDeploymentStatus = (
    rowIndex: number,
    columnIndex: number,
    tableColumn: ITableColumn<IDeploymentField>,
    tableItem: IDeploymentField
  ): JSX.Element => {
    if (!tableItem.status) {
      return (
        <SimpleTableCell key={"col-" + columnIndex} columnIndex={columnIndex} />
      );
    }
    const indicatorData = this.getStatusIndicatorData(tableItem.status);
    return (
      <SimpleTableCell
        columnIndex={columnIndex}
        tableColumn={tableColumn}
        key={"col-" + columnIndex}
        contentClassName="fontWeightSemiBold font-weight-semibold fontSizeM font-size-m scroll-hidden"
      >
        <Status
          {...indicatorData.statusProps}
          className={"icon-large-margin " + indicatorData.classname}
          size={StatusSize.l}
        />
      </SimpleTableCell>
    );
  };

  private WithIcon = (props: {
    className?: string;
    iconProps: IIconProps;
    children?: React.ReactNode;
  }) => {
    return (
      <div className="flex-row flex-center">
        {Icon({ ...props.iconProps, className: "icon-margin" })}
        {props.children}
      </div>
    );
  };

  private getStatusIndicatorData = (
    statusStr: string
  ): IStatusIndicatorData => {
    statusStr = statusStr || "";
    statusStr = statusStr.toLowerCase();
    const indicatorData: IStatusIndicatorData = {
      classname: "icon-green",
      label: "Success",
      statusProps: {
        ...Statuses.Success,
        ariaLabel: "Success",
        color: iconColors.green
      }
    };
    switch (statusStr.toLowerCase()) {
      case "failed":
        indicatorData.statusProps = {
          ...Statuses.Failed,
          ariaLabel: "Failed",
          color: iconColors.red
        };
        indicatorData.label = "Failed";
        indicatorData.classname = "icon-red";
        break;
      case "in progress":
        indicatorData.statusProps = {
          ...Statuses.Running,
          ariaLabel: "Running",
          color: iconColors.blue
        };
        indicatorData.label = "Running";
        indicatorData.classname = "icon-blue";
        break;
      case "waiting":
        indicatorData.statusProps = {
          ...Statuses.Waiting,
          ariaLabel: "Waiting",
          color: iconColors.purple
        };
        indicatorData.label = "Waiting";
        indicatorData.classname = "icon-purple";
        break;
      case "incomplete":
        indicatorData.statusProps = {
          ...Statuses.Warning,
          ariaLabel: "Incomplete",
          color: iconColors.yellow
        };
        indicatorData.label = "Incomplete";
        indicatorData.classname = "icon-yellow";
        break;
      case "canceled":
        indicatorData.statusProps = {
          ...Statuses.Canceled,
          ariaLabel: "Canceled",
          color: iconColors.gray
        };
        indicatorData.label = "Canceled";
        indicatorData.classname = "icon-gray";
        break;
    }
    return indicatorData;
  };

  private getAuthorRequestParams = (deployment: IDeployment) => {
    const query: { [key: string]: string } = {};
    const commit =
      deployment.srcToDockerBuild?.sourceVersion ||
      deployment.hldToManifestBuild?.sourceVersion;
    let repo: IAzureDevOpsRepo | IGitHub | undefined =
      deployment.srcToDockerBuild?.repository ||
      (deployment.sourceRepo
        ? getRepositoryFromURL(deployment.sourceRepo)
        : undefined);
    if (!repo && (deployment.hldToManifestBuild || deployment.hldRepo)) {
      repo =
        deployment.hldToManifestBuild!.repository ||
        (deployment.hldRepo
          ? getRepositoryFromURL(deployment.hldRepo)
          : undefined);
    }
    if (repo && "username" in repo && commit) {
      query.username = repo.username;
      query.reponame = repo.reponame;
      query.commit = commit;
    } else if (repo && "org" in repo && commit) {
      query.org = repo.org;
      query.project = repo.project;
      query.repo = repo.repo;
      query.commit = commit;
    }
    return Object.keys(query)
      .map(k => `${k}=${encodeURIComponent(query[k])}`)
      .join("&");
  };

  private getPRRequestParams = (deployment: IDeployment) => {
    const query: { [key: string]: string } = {};
    if (!deployment.hldRepo) {
      return "";
    }
    const repo: IAzureDevOpsRepo | IGitHub | undefined = getRepositoryFromURL(
      deployment.hldRepo
    );
    if (repo && "username" in repo && deployment.pr) {
      query.username = repo.username;
      query.reponame = repo.reponame;
      query.pr = deployment.pr!.toString();
    } else if (repo && "org" in repo && deployment.pr) {
      query.org = repo.org;
      query.project = repo.project;
      query.repo = repo.repo;
      query.pr = deployment.pr!.toString();
    }

    return Object.keys(query)
      .map(k => `${k}=${encodeURIComponent(query[k])}`)
      .join("&");
  };

  private getPRs = () => {
    try {
      const state = this.state;
      this.state.deployments.forEach(deployment => {
        if (deployment.pr) {
          const queryParams = this.getPRRequestParams(deployment);
          if (queryParams !== "") {
            HttpHelper.httpGet("/api/pr?" + queryParams).then(data => {
              const pr = data.data as IPullRequest;
              if (pr && deployment.pr) {
                const copy = state.prs;
                copy[deployment.pr] = pr;
                this.setState({ prs: copy });
                this.updateFilteredDeployments();
              }
            });
          }
        }
      });
    } catch (err) {
      console.error(err);
    }
  };

  private getAuthors = () => {
    try {
      const state = this.state;
      const promises: Array<Promise<any>> = [];
      this.state.deployments.forEach(deployment => {
        const queryParams = this.getAuthorRequestParams(deployment);
        if (queryParams !== "") {
          const promise = HttpHelper.httpGet("/api/author?" + queryParams);

          promise.then(data => {
            const author = data.data as IAuthor;
            if (author && deployment.srcToDockerBuild) {
              const copy = state.authors;
              copy[deployment.srcToDockerBuild.sourceVersion] = author;
              this.setState({ authors: copy });
              this.updateFilteredDeployments();
            } else if (author && deployment.hldToManifestBuild) {
              const copy = state.authors;
              copy[deployment.hldToManifestBuild.sourceVersion] = author;
              this.setState({ authors: copy });
              this.updateFilteredDeployments();
            }
          });
          promises.push(promise);
        }
      });

      Promise.all(promises).then(() => {
        if (!this.filterState.defaultApplied) {
          this.filter.setFilterItemState("authorFilter", {
            value: this.filterState.currentlySelectedAuthors
          });
          this.filterState.defaultApplied = true;
        }
      });
    } catch (err) {
      console.error(err);
    }
  };

  private getAuthor = (deployment: IDeployment): IAuthor | undefined => {
    if (
      deployment.srcToDockerBuild &&
      deployment.srcToDockerBuild.sourceVersion in this.state.authors
    ) {
      deployment.author = this.state.authors[
        deployment.srcToDockerBuild.sourceVersion
      ];
      return this.state.authors[deployment.srcToDockerBuild.sourceVersion];
    } else if (
      deployment.hldToManifestBuild &&
      deployment.hldToManifestBuild.sourceVersion in this.state.authors
    ) {
      deployment.author = this.state.authors[
        deployment.hldToManifestBuild.sourceVersion
      ];
      return this.state.authors[deployment.hldToManifestBuild.sourceVersion];
    }
    return undefined;
  };

  private getPR = (deployment: IDeployment): IPullRequest | undefined => {
    if (deployment.pr && deployment.pr in this.state.prs) {
      return this.state.prs[deployment.pr];
    }
    return undefined;
  };

  private getIcon(statusStr?: string): IIconProps {
    if (statusStr === "succeeded") {
      return {
        iconName: "SkypeCircleCheck",
        style: { color: iconColors.green }
      };
    } else if (statusStr === undefined || statusStr === "inProgress") {
      return { iconName: "AwayStatus", style: { color: iconColors.blue } }; // SyncStatusSolid
    } else if (statusStr === "canceled") {
      return {
        iconName: "SkypeCircleSlash",
        style: { color: iconColors.gray }
      };
    } else if (statusStr === "waiting") {
      return { iconName: "AwayStatus", style: { color: iconColors.purple } };
    }
    return { iconName: "StatusErrorFull", style: { color: iconColors.red } };
  }
}

export default Dashboard;
