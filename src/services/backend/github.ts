import type { RepoId } from "../../domain"
import { humanizeStargazersCount } from "../../helpers/conversion-helpers"
import * as cacheSharedServices from "../shared/cache"

const REPO_URL_REGEX = /^https:\/\/github.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)$/
const REPO_URL_PATTERN = "https://github.com/{owner}/{repo}"
const GET_REPO_API_URL_PATTERN = "https://api.github.com/repos/{owner}/{repo}"

// Start the app with `DONT_FETCH_DATA= npm run dev` to *not* mock GitHub API calls locally
const DONT_FETCH_DATA = Boolean(process.env["DONT_FETCH_GITHUB_STARS_DATA"])

export interface GitHubRepoRelatedData {
    codeUrl: string | null // e.g. "https://github.com/Textualize/textual"
    stars: string | null // e.g. "9.5k",
}

export interface GitHubRepoStatistics {
    repoId: RepoId
    starsCount: number
}

export async function attachCurrentStarsCountsToRepositories(
    repoRelatedDataItems: GitHubRepoRelatedData[]
): Promise<void> {
    // Each promise fetches the GitHub stats for a single repo...
    const repositoriesStatsPromises = repoRelatedDataItems.map((item) => {
        const repoId = repoIdFromUrl(item.codeUrl ?? "")
        return repoStatistics(repoId)
    })
    // ...But we launch them in parallel:
    const repositoriesStatsSettledPromises = await Promise.allSettled(repositoriesStatsPromises)

    // Now we just have to replace the "stars" of each object with the ones we got from the GitHub API
    // (but only for successfully fulfilled Promises)
    repoRelatedDataItems.map((item, index) => {
        const matchingRepositoriesStatsSettledPromise = repositoriesStatsSettledPromises[index]
        switch (matchingRepositoriesStatsSettledPromise.status) {
            case "fulfilled":
                // Replace this value with the dynamically retrieved one:
                const repoStats = matchingRepositoriesStatsSettledPromise.value
                const stars = humanizeStargazersCount(repoStats.starsCount)
                item.stars = stars
                break
            case "rejected":
                console.error(
                    `Could not fetch GitHub stats for repo "${item.codeUrl}": ${matchingRepositoriesStatsSettledPromise.reason}`
                )
                break
        }
    })
}

export async function repoStatistics(repoId: RepoId): Promise<GitHubRepoStatistics> {
    const cacheKey = `github-repo-statistics:${repoId.owner}/${repoId.repo}`
    const cachedValue = await cacheSharedServices.get(cacheKey)
    if (cachedValue) {
        return cachedValue
    }

    let result: GitHubRepoStatistics | null = null

    if (DONT_FETCH_DATA) {
        console.debug("Returning fake random GitHub repo stats for repo ", repoId, "")
        result = {
            repoId,
            starsCount: 200 + Math.round(Math.random() * 10_000),
        }
    } else {
        const resp = await repoStatisticsRawResponse(repoId)
        if (resp.status !== 200) {
            throw new Error(
                `GitHub repo stats for repo "${repoId.owner}/${repoId.repo}" failed: status code=${resp.status}`
            )
        }

        const respData = await resp.json()
        const stargazersCount = respData["stargazers_count"]

        console.debug("Stargazers count for repo ", repoId, ": ", stargazersCount)

        result = {
            repoId,
            starsCount: stargazersCount,
        }
    }

    await cacheSharedServices.set(cacheKey, result)

    return result
}

export async function repoStatisticsRawResponse(repoId: RepoId): Promise<Response> {
    const targetEndpointUrl = repoDataApiEndpointUrl(repoId)
    const gitHubApiHeaders = new Headers({
        Accept: "application/vnd.github.v3+json",
    })

    console.debug("Fetching GitHub repo stats for repo ", repoId, "...")

    const apiCallPromise = fetch(targetEndpointUrl, {
        headers: gitHubApiHeaders,
    })

    return apiCallPromise
}

export function repoIdFromUrl(repoUrl: string): RepoId {
    const regexMatch = REPO_URL_REGEX.exec(repoUrl ?? "")
    if (!regexMatch) {
        throw new Error(`Not a GitHub repo URL: "${repoUrl}"`)
    }
    // @ts-ignore
    const { owner, repo } = regexMatch.groups
    return { owner, repo }
}

export function repoUrl(repoId: RepoId): string {
    return REPO_URL_PATTERN.replace("{owner}", repoId.owner).replace("{repo}", repoId.repo)
}

export function repoDataApiEndpointUrl(repoId: RepoId): string {
    return GET_REPO_API_URL_PATTERN.replace("{owner}", repoId.owner).replace("{repo}", repoId.repo)
}
